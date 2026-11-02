/**
 * Proves the publishable package is what a consumer installs: packs a staged package directory,
 * unpacks the tarball into a scratch `node_modules/@fro.bot/wiki-write-core`, and resolves, imports
 * and type-checks every `exports` subpath from it under Node. Driven by `build-wiki-write-core.ts
 * --verify` and by the tarball tests in `wiki-write-core-package.test.ts`.
 */
import {execFileSync} from 'node:child_process'
import {mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'

import {GATE_CONTRACT_VERSION} from '../packages/wiki-write-core/src/gate-contract.ts'

function repositoryRoot(): string {
  return resolve(import.meta.dirname, '..')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface PackageVerification {
  files: string[]
  sourceTreeHash: string
  subpaths: string[]
}

/** The file names `npm pack --json` reports, across the array shape of npm <=11 and the keyed object of npm 12. */
export function parsePackResult(output: string): {filename: string; files: string[]} {
  const parsed: unknown = JSON.parse(output)
  const result: unknown = Array.isArray(parsed) ? parsed[0] : isRecord(parsed) ? Object.values(parsed)[0] : undefined
  if (!isRecord(result) || typeof result.filename !== 'string' || !Array.isArray(result.files)) {
    throw new Error('unexpected npm pack --json output')
  }
  const files = result.files.map((file: unknown) => {
    if (!isRecord(file) || typeof file.path !== 'string') throw new Error('unexpected npm pack file entry')
    return file.path
  })
  return {filename: result.filename, files}
}

// Evaluated by a child `node` inside the consumer directory, so resolution follows the real
// `node_modules/@fro.bot/wiki-write-core` lookup a downstream install performs.
function resolveProbeSource(): string {
  return [
    "import {readFileSync} from 'node:fs'",
    'const specifiers = JSON.parse(readFileSync(process.argv[2], "utf8"))',
    'const resolved = {}',
    'for (const specifier of specifiers) {',
    '  const url = import.meta.resolve(specifier)',
    '  let sourceTreeHash',
    '  if (!specifier.endsWith("/package.json")) {',
    '    const loaded = await import(specifier)',
    '    if (specifier === "@fro.bot/wiki-write-core") sourceTreeHash = loaded.GATE_SOURCE_TREE_HASH',
    '  }',
    '  resolved[specifier] = {url, sourceTreeHash}',
    '}',
    'process.stdout.write(JSON.stringify(resolved))',
    '',
  ].join('\n')
}

interface VerifyStagedPackageOptions {
  exec?: typeof execFileSync
  repositoryRoot?: string
}

/**
 * Proves the staged package is what a consumer installs: packs it, unpacks the tarball into a scratch
 * `node_modules/@fro.bot/wiki-write-core`, then, under Node, resolves and imports every `exports`
 * subpath, checks each target and its declaration file is in the tarball, and type-checks a
 * consumer module that imports every subpath. Throws on the first violated expectation.
 */
export async function verifyStagedPackage(
  stageRoot: string,
  options: VerifyStagedPackageOptions = {},
): Promise<PackageVerification> {
  const exec = options.exec ?? execFileSync
  const root = options.repositoryRoot ?? repositoryRoot()
  const workRoot = await mkdtemp(join(tmpdir(), 'wiki-write-core-verify-'))

  try {
    const pack = parsePackResult(
      exec('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', workRoot], {
        cwd: stageRoot,
        encoding: 'utf8',
      }),
    )
    const stray = pack.files.filter(
      file => !['LICENSE.md', 'README.md', 'package.json'].includes(file) && !file.startsWith('dist/'),
    )
    if (stray.length > 0) throw new Error(`tarball contains files outside dist/: ${stray.join(', ')}`)

    const consumerRoot = join(workRoot, 'consumer')
    const installed = join(consumerRoot, 'node_modules', '@fro.bot', 'wiki-write-core')
    await mkdir(installed, {recursive: true})
    exec('tar', ['-xzf', join(workRoot, pack.filename), '-C', installed, '--strip-components=1'])

    const manifest: unknown = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'))
    if (!isRecord(manifest) || !isRecord(manifest.exports)) throw new Error('tarball manifest must define exports')
    const packedFiles = new Set(pack.files)
    const specifiers: string[] = []
    const declarations: string[] = []
    for (const [subpath, target] of Object.entries(manifest.exports)) {
      const specifier = subpath === '.' ? '@fro.bot/wiki-write-core' : `@fro.bot/wiki-write-core/${subpath.slice(2)}`
      specifiers.push(specifier)
      if (subpath === './package.json') continue
      if (!isRecord(target) || typeof target.import !== 'string' || typeof target.types !== 'string') {
        throw new Error(`tarball export ${subpath} must declare types and import`)
      }
      for (const file of [target.import, target.types]) {
        if (!file.startsWith('./dist/') || !packedFiles.has(file.slice(2))) {
          throw new Error(`tarball export ${subpath} targets ${file}, which is not a packed dist file`)
        }
      }
      if (!target.types.endsWith('.d.ts')) throw new Error(`tarball export ${subpath} types must be a .d.ts file`)
      declarations.push(specifier)
    }

    // The consumer resolves the package's own dependencies from this repository's install.
    const dependencies = isRecord(manifest.dependencies) ? Object.keys(manifest.dependencies) : []
    for (const dependency of ['@types/node', ...dependencies]) {
      const link = join(consumerRoot, 'node_modules', dependency)
      await mkdir(dirname(link), {recursive: true})
      await symlink(join(root, 'node_modules', dependency), link)
    }

    const specifiersPath = join(consumerRoot, 'specifiers.json')
    await writeFile(specifiersPath, JSON.stringify(specifiers))
    await writeFile(join(consumerRoot, 'probe.mjs'), resolveProbeSource())
    const probeOutput = exec('node', [join(consumerRoot, 'probe.mjs'), specifiersPath], {
      cwd: consumerRoot,
      encoding: 'utf8',
    })
    const resolved: unknown = JSON.parse(probeOutput)
    if (!isRecord(resolved)) throw new Error('unexpected resolution probe output')

    const installedReal = await realpath(installed)
    for (const specifier of specifiers) {
      const entry = resolved[specifier]
      if (!isRecord(entry) || typeof entry.url !== 'string') throw new Error(`${specifier} did not resolve`)
      const path = await realpath(fileURLToPath(entry.url))
      if (!path.startsWith(installedReal + sep)) throw new Error(`${specifier} resolved outside the tarball: ${path}`)
    }

    const marker: unknown = JSON.parse(await readFile(join(installed, 'dist', 'gate-contract.json'), 'utf8'))
    const rootEntry = resolved['@fro.bot/wiki-write-core']
    const exportedHash = isRecord(rootEntry) ? rootEntry.sourceTreeHash : undefined
    if (
      !isRecord(marker) ||
      marker.version !== GATE_CONTRACT_VERSION ||
      typeof marker.sourceTreeHash !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(marker.sourceTreeHash) ||
      marker.sourceTreeHash !== exportedHash
    ) {
      throw new Error('tarball gate contract marker does not match the exported GATE_SOURCE_TREE_HASH')
    }

    await writeFile(
      join(consumerRoot, 'consumer.ts'),
      `${declarations.map((specifier, index) => `import * as module${index} from '${specifier}'`).join('\n')}\n` +
        `export const modules = [${declarations.map((_, index) => `module${index}`).join(', ')}]\n`,
    )
    await writeFile(
      join(consumerRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'ESNext',
          moduleResolution: 'Bundler',
          noEmit: true,
          skipLibCheck: false,
          strict: true,
          target: 'ES2022',
          types: ['node'],
        },
        files: ['consumer.ts'],
      }),
    )
    try {
      exec(
        join(root, 'node_modules', '.bin', 'tsc'),
        ['--project', join(consumerRoot, 'tsconfig.json'), '--pretty', 'false'],
        {cwd: consumerRoot, encoding: 'utf8'},
      )
    } catch (error: unknown) {
      const output = isRecord(error) && typeof error.stdout === 'string' ? error.stdout.trim() : String(error)
      throw new Error(`tarball declarations do not type-check:\n${output}`, {cause: error})
    }

    return {files: pack.files, sourceTreeHash: marker.sourceTreeHash, subpaths: specifiers}
  } finally {
    await rm(workRoot, {force: true, recursive: true})
  }
}
