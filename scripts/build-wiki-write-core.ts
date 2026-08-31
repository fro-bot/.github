import {Buffer} from 'node:buffer'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile} from 'node:fs/promises'
import {dirname, join, relative, resolve, sep} from 'node:path'
import process from 'node:process'

const repositoryRoot = resolve(import.meta.dirname, '..')
const sourceRoot = join(repositoryRoot, 'packages', 'wiki-write-core', 'src')
const distRoot = join(repositoryRoot, 'packages', 'wiki-write-core', 'dist')
const buildConfig = join(repositoryRoot, 'packages', 'wiki-write-core', 'tsconfig.build.json')
const packageManifest = join(repositoryRoot, 'packages', 'wiki-write-core', 'package.json')
const sourceHashPlaceholder = '__SOURCE_TREE_HASH__'

const checkOnly = process.argv.includes('--check')

async function main(): Promise<void> {
  const temporaryRoot = await mkdtemp(join(dirname(distRoot), '.wiki-write-core-dist-'))
  let temporaryRootOwned = true

  try {
    if (await pathExists(distRoot)) {
      await collectFiles(distRoot)
    }
    await mkdir(temporaryRoot, {recursive: true})

    execFileSync('pnpm', ['exec', 'tsc', '--project', buildConfig, '--outDir', temporaryRoot, '--pretty', 'false'], {
      cwd: repositoryRoot,
      stdio: 'inherit',
    })

    const sourceHash = await computeSourceTreeHash()
    await collectFiles(temporaryRoot)
    await embedSourceTreeHash(temporaryRoot, sourceHash)
    await rewriteDeclarationExtensions(temporaryRoot)
    await collectFiles(temporaryRoot)

    if (checkOnly) {
      const differences = await compareTrees(temporaryRoot, distRoot)
      if (differences.length > 0) {
        throw new Error(`wiki-write-core dist is stale:\n${differences.map(path => `- ${path}`).join('\n')}`)
      }
      process.stdout.write('wiki-write-core dist is up to date\n')
    } else {
      await replaceDirectoryAtomically(temporaryRoot, distRoot)
      temporaryRootOwned = false
    }
  } finally {
    if (temporaryRootOwned) {
      await rm(temporaryRoot, {force: true, recursive: true})
    }
  }
}

interface SourceTreeHashOptions {
  buildConfigPath?: string
  manifestPath?: string
  resolvedBuildConfig?: unknown
  sourceRoot?: string
}

export async function computeSourceTreeHash(options: SourceTreeHashOptions = {}): Promise<string> {
  const currentSourceRoot = options.sourceRoot ?? sourceRoot
  const currentBuildConfig = options.buildConfigPath ?? buildConfig
  const currentManifest = options.manifestPath ?? packageManifest
  const files = (await collectFiles(currentSourceRoot))
    .filter(path => !path.endsWith('.test.ts'))
    .sort((left, right) => left.localeCompare(right))
  const hash = createHash('sha256')

  for (const path of files) {
    const relativePath = relative(currentSourceRoot, path).split(sep).join('/')
    const content = await readFile(path)
    updateHash(hash, `source/${relativePath}`, content)
  }

  const resolvedConfig = options.resolvedBuildConfig ?? resolveBuildConfig(currentBuildConfig)
  updateHash(hash, 'build-config/tsconfig.build.json', stableJson(resolvedConfig))

  const manifest = parsePackageManifest(await readFile(currentManifest, 'utf8'), currentManifest)
  updateHash(hash, 'package/exports', stableJson(manifest.exports))
  updateHash(hash, 'package/files', stableJson([...manifest.files].sort((left, right) => left.localeCompare(right))))

  return hash.digest('hex')
}

export function resolveBuildConfig(configPath: string): unknown {
  const resolvedConfig = execFileSync(
    'pnpm',
    ['exec', 'tsc', '--showConfig', '--project', configPath, '--pretty', 'false'],
    {cwd: repositoryRoot, encoding: 'utf8'},
  )
  return JSON.parse(resolvedConfig) as unknown
}

export async function collectFiles(directory: string, label = 'wiki-write-core dist'): Promise<string[]> {
  const directoryInfo = await lstat(directory)
  if (directoryInfo.isSymbolicLink()) {
    throw new Error(`symlink is not allowed in ${label}: ${displayPath(directory)}`)
  }

  const entries = await readdir(directory, {withFileTypes: true})
  const files: string[] = []

  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      throw new Error(`symlink is not allowed in ${label}: ${displayPath(path)}`)
    } else if (entry.isDirectory()) {
      files.push(...(await collectFiles(path, label)))
    } else if (entry.isFile()) {
      files.push(path)
    }
  }

  return files
}

export async function embedSourceTreeHash(outputRoot: string, sourceHash: string): Promise<void> {
  const contractPath = join(outputRoot, 'gate-contract.js')
  const content = await readFile(contractPath, 'utf8')
  const occurrences = content.split(sourceHashPlaceholder).length - 1
  if (occurrences !== 1) {
    throw new Error(`expected one source-tree hash placeholder in ${contractPath}, found ${occurrences}`)
  }
  await writeFile(contractPath, content.replace(sourceHashPlaceholder, sourceHash), 'utf8')
}

export async function rewriteDeclarationExtensions(outputRoot: string): Promise<void> {
  for (const path of await collectFiles(outputRoot)) {
    if (!path.endsWith('.d.ts')) continue
    const content = await readFile(path, 'utf8')
    const rewritten = content.replaceAll(/(\bfrom\s+|\bimport\s*\(\s*)(['"])(\.\.?\/[^'"]+)\.ts\2/gu, '$1$2$3.js$2')
    if (rewritten !== content) {
      await writeFile(path, rewritten, 'utf8')
    }
  }
}

export async function compareTrees(leftRoot: string, rightRoot: string): Promise<string[]> {
  const [leftFiles, rightFiles] = await Promise.all([collectFiles(leftRoot), collectFilesIfPresent(rightRoot)])
  const allPaths = new Set([
    ...leftFiles.map(path => relative(leftRoot, path)),
    ...rightFiles.map(path => relative(rightRoot, path)),
  ])
  const differences: string[] = []

  for (const relativePath of [...allPaths].sort((left, right) => left.localeCompare(right))) {
    const leftPath = join(leftRoot, relativePath)
    const rightPath = join(rightRoot, relativePath)
    let leftContent: Buffer | undefined
    let rightContent: Buffer | undefined

    try {
      leftContent = await readFile(leftPath)
    } catch (error: unknown) {
      if (!isFileNotFoundError(error)) throw error
    }

    try {
      rightContent = await readFile(rightPath)
    } catch (error: unknown) {
      if (!isFileNotFoundError(error)) throw error
    }

    if (leftContent === undefined || rightContent === undefined || !leftContent.equals(rightContent)) {
      differences.push(relativePath)
    }
  }

  return differences
}

export async function replaceDirectoryAtomically(
  source: string,
  target: string,
  renameDirectory: typeof rename = rename,
): Promise<void> {
  const backup = await mkdtemp(join(dirname(target), '.wiki-write-core-dist-backup-'))
  await rm(backup, {force: true, recursive: true})
  let targetMoved = false

  try {
    if (await pathExists(target)) {
      await renameDirectory(target, backup)
      targetMoved = true
    }
    await renameDirectory(source, target)
  } catch (error: unknown) {
    if (targetMoved) {
      await renameDirectory(backup, target)
      targetMoved = false
    }
    throw error
  } finally {
    if (targetMoved || (await pathExists(backup))) {
      await rm(backup, {force: true, recursive: true})
    }
  }
}

function updateHash(hash: ReturnType<typeof createHash>, label: string, content: Buffer | string): void {
  const byteLength = Buffer.isBuffer(content) ? content.byteLength : Buffer.byteLength(content)
  hash.update(label)
  hash.update('\0')
  hash.update(String(byteLength))
  hash.update('\0')
  hash.update(content)
  hash.update('\0')
}

export function parsePackageManifest(content: string, path: string): {exports: unknown; files: string[]} {
  const parsed: unknown = JSON.parse(content)
  if (
    !isRecord(parsed) ||
    !Array.isArray(parsed.files) ||
    !parsed.files.every((file): file is string => typeof file === 'string')
  ) {
    throw new Error(`package manifest must define a string files array: ${displayPath(path)}`)
  }
  if (!('exports' in parsed)) {
    throw new Error(`package manifest must define exports: ${displayPath(path)}`)
  }
  return {exports: parsed.exports, files: parsed.files}
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => stableJson(item)).join(',')}]`
  }
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  throw new Error('package manifest contains an unsupported value')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error: unknown) {
    if (isFileNotFoundError(error)) return false
    throw error
  }
}

async function collectFilesIfPresent(directory: string): Promise<string[]> {
  try {
    return await collectFiles(directory)
  } catch (error: unknown) {
    if (isFileNotFoundError(error)) return []
    throw error
  }
}

function displayPath(path: string): string {
  return relative(repositoryRoot, path).split(sep).join('/') || path
}

function isFileNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

// Deliberately use Node's main-module check: unlike the repository's legacy scripts, it survives
// symlinks and spaces in paths without reconstructing a file URL from argv[1].
if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
