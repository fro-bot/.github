import {Buffer} from 'node:buffer'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile} from 'node:fs/promises'
import {dirname, join, relative, resolve, sep} from 'node:path'
import process from 'node:process'

import {GATE_CONTRACT_VERSION} from '../packages/wiki-write-core/src/gate-contract.ts'

// Each of these is a function, not a top-level `const`: a module-level const initializer runs
// once per Stryker worker process (not per call), making its literal-segment mutants "static"
// and unobservable by per-test coverage attribution; a function body re-evaluates on every
// call, so each path segment carries an ordinary, per-call-killable mutant instead.
export function repositoryRoot(): string {
  return resolve(import.meta.dirname, '..')
}

export function sourceRoot(): string {
  return join(repositoryRoot(), 'packages', 'wiki-write-core', 'src')
}

export function distRoot(): string {
  return join(repositoryRoot(), 'packages', 'wiki-write-core', 'dist')
}

export function buildConfig(): string {
  return join(repositoryRoot(), 'packages', 'wiki-write-core', 'tsconfig.build.json')
}

export function packageManifest(): string {
  return join(repositoryRoot(), 'packages', 'wiki-write-core', 'package.json')
}

export function sourceHashPlaceholder(): string {
  return '__SOURCE_TREE_HASH__'
}

/** Whether the CLI was invoked with `--check` (verify only, never write). Pure and testable in isolation. */
export function resolveCheckOnly(argv: readonly string[] = process.argv): boolean {
  return argv.includes('--check')
}

const checkOnly = resolveCheckOnly()

interface RunTypeScriptBuildOptions {
  buildConfigPath?: string
  cwd?: string
  spawn?: typeof execFileSync
}

/**
 * Runs the package's TypeScript build into `outputDirectory`. `spawn` is an injectable seam
 * (default `execFileSync`) so tests can assert on the exact command/args/options without
 * actually invoking `tsc`.
 */
export function runTypeScriptBuild(outputDirectory: string, options: RunTypeScriptBuildOptions = {}): void {
  const spawn = options.spawn ?? execFileSync
  spawn(
    'pnpm',
    [
      'exec',
      'tsc',
      '--project',
      options.buildConfigPath ?? buildConfig(),
      '--outDir',
      outputDirectory,
      '--pretty',
      'false',
    ],
    {
      cwd: options.cwd ?? repositoryRoot(),
      stdio: 'inherit',
    },
  )
}

export interface RunBuildOptions {
  buildConfigPath?: string
  checkOnly?: boolean
  distRoot?: string
  manifestPath?: string
  runTypeScriptBuild?: (outputDirectory: string) => void
  sourceRoot?: string
  write?: (message: string) => void
}

/**
 * The assembled build/check flow `main()` drives. All I/O boundaries that would otherwise
 * make this unreachable outside a real CLI invocation are injectable: `runTypeScriptBuild`
 * (default: `runTypeScriptBuild`, which spawns real `tsc`) and every path default.
 */
export async function runBuild(options: RunBuildOptions = {}): Promise<void> {
  const currentSourceRoot = options.sourceRoot ?? sourceRoot()
  const currentDistRoot = options.distRoot ?? distRoot()
  const currentBuildConfig = options.buildConfigPath ?? buildConfig()
  const currentManifest = options.manifestPath ?? packageManifest()
  const currentCheckOnly = options.checkOnly ?? checkOnly
  const buildTypeScript = options.runTypeScriptBuild ?? runTypeScriptBuild
  const write = options.write ?? writeToStdout

  const temporaryRoot = await mkdtemp(join(dirname(currentDistRoot), '.wiki-write-core-dist-'))
  let temporaryRootOwned = true

  try {
    if (await pathExists(currentDistRoot)) {
      await collectFiles(currentDistRoot)
    }
    await mkdir(temporaryRoot, {recursive: true})

    buildTypeScript(temporaryRoot)

    const sourceHash = await computeSourceTreeHash({
      sourceRoot: currentSourceRoot,
      buildConfigPath: currentBuildConfig,
      manifestPath: currentManifest,
    })
    await collectFiles(temporaryRoot)
    await embedSourceTreeHash(temporaryRoot, sourceHash)
    await writeGateContractMarker(temporaryRoot, sourceHash)
    await rewriteDeclarationExtensions(temporaryRoot)
    await collectFiles(temporaryRoot)

    if (currentCheckOnly) {
      const differences = await compareTrees(temporaryRoot, currentDistRoot)
      if (differences.length > 0) {
        throw new Error(`wiki-write-core dist is stale:\n${differences.map(path => `- ${path}`).join('\n')}`)
      }
      write('wiki-write-core dist is up to date\n')
    } else {
      await replaceDirectoryAtomically(temporaryRoot, currentDistRoot)
      temporaryRootOwned = false
    }
  } finally {
    // `force: true` is deliberately omitted: whenever temporaryRootOwned is true, temporaryRoot
    // genuinely still exists (mkdtemp created it, and nothing removes or renames it away while
    // still owned) — `recursive: true` alone is correct, and a stray rm on a directory that was
    // already replaced would now surface as a real, test-visible error instead of a silent
    // force:true no-op.
    if (temporaryRootOwned) {
      await rm(temporaryRoot, {recursive: true})
    }
  }
}

function writeToStdout(message: string): void {
  process.stdout.write(message)
}

export function reportFatalError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
}

interface SourceTreeHashOptions {
  buildConfigPath?: string
  manifestPath?: string
  readEntries?: typeof readdir
  resolvedBuildConfig?: unknown
  sourceRoot?: string
}

export async function computeSourceTreeHash(options: SourceTreeHashOptions = {}): Promise<string> {
  const currentSourceRoot = options.sourceRoot ?? sourceRoot()
  const currentBuildConfig = options.buildConfigPath ?? buildConfig()
  const currentManifest = options.manifestPath ?? packageManifest()
  const readEntries = options.readEntries ?? readdir
  const files = (await collectFiles(currentSourceRoot, 'wiki-write-core dist', readEntries))
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

  const manifest = parsePackageManifest((await readFile(currentManifest)).toString(), currentManifest)
  updateHash(hash, 'package/exports', stableJson(manifest.exports))
  updateHash(hash, 'package/files', stableJson([...manifest.files].sort((left, right) => left.localeCompare(right))))

  return hash.digest('hex')
}

export function resolveBuildConfig(configPath: string, options: {spawn?: typeof execFileSync} = {}): unknown {
  const spawn = options.spawn ?? execFileSync
  const resolvedConfig = spawn('pnpm', ['exec', 'tsc', '--showConfig', '--project', configPath, '--pretty', 'false'], {
    cwd: repositoryRoot(),
    encoding: 'utf8',
  })
  return JSON.parse(resolvedConfig) as unknown
}

export async function collectFiles(
  directory: string,
  label = 'wiki-write-core dist',
  readEntries: typeof readdir = readdir,
): Promise<string[]> {
  const directoryInfo = await lstat(directory)
  if (directoryInfo.isSymbolicLink()) {
    throw new Error(`symlink is not allowed in ${label}: ${displayPath(directory)}`)
  }

  const entries = await readEntries(directory, {withFileTypes: true})
  const files: string[] = []

  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      throw new Error(`symlink is not allowed in ${label}: ${displayPath(path)}`)
    } else if (entry.isDirectory()) {
      files.push(...(await collectFiles(path, label, readEntries)))
    } else if (entry.isFile()) {
      files.push(path)
    }
  }

  return files
}

export async function embedSourceTreeHash(outputRoot: string, sourceHash: string): Promise<void> {
  const contractPath = join(outputRoot, 'gate-contract.js')
  const content = await readFile(contractPath, 'utf8')
  const occurrences = content.split(sourceHashPlaceholder()).length - 1
  if (occurrences !== 1) {
    throw new Error(`expected one source-tree hash placeholder in ${contractPath}, found ${occurrences}`)
  }
  await writeFile(contractPath, content.replace(sourceHashPlaceholder(), sourceHash))
}

// The version is the gate criterion; sourceTreeHash is diagnostic only because it moves with
// ordinary source changes and must not turn unrelated package edits into write refusals.
export async function writeGateContractMarker(outputRoot: string, sourceTreeHash: string): Promise<void> {
  const markerPath = join(outputRoot, 'gate-contract.json')
  await writeFile(markerPath, `${JSON.stringify({version: GATE_CONTRACT_VERSION, sourceTreeHash})}\n`)
}

export async function rewriteDeclarationExtensions(outputRoot: string): Promise<void> {
  for (const path of await collectFiles(outputRoot)) {
    if (!path.endsWith('.d.ts')) continue
    const content = await readFile(path, 'utf8')
    const rewritten = content.replaceAll(/(\bfrom\s+|\bimport\s*\(\s*)(['"])(\.\.?\/[^'"]+)\.ts\2/gu, '$1$2$3.js$2')
    if (rewritten !== content) {
      await writeFile(path, rewritten)
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
  // `force: true` is deliberately omitted: mkdtemp just created `backup`, so it always exists
  // at this point — this call exists only to vacate the unique path mkdtemp reserved, not to
  // tolerate a missing directory.
  await rm(backup, {recursive: true})
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
    // `pathExists(backup)` is redundant with `targetMoved`: backup is unconditionally removed
    // immediately above (before targetMoved can ever become true), and the only place it is
    // (re)created is the `targetMoved = true` assignment, which the catch block's restore
    // unwinds back to false before this finally runs. targetMoved's value and backup's
    // existence are therefore always equal here, so `force: true` would only ever mask a real
    // bug in that invariant.
    if (targetMoved) {
      await rm(backup, {recursive: true})
    }
  }
}

export function updateHash(hash: ReturnType<typeof createHash>, label: string, content: Buffer | string): void {
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

/** @internal */
export function stableJson(value: unknown): string {
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

/** @internal */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function pathExists(path: string, lstatPath: typeof lstat = lstat): Promise<boolean> {
  try {
    await lstatPath(path)
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
  return relative(repositoryRoot(), path).split(sep).join('/') || path
}

export function isFileNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

// Deliberately use Node's main-module check: unlike the repository's legacy scripts, it survives
// symlinks and spaces in paths without reconstructing a file URL from argv[1].
// Stryker disable next-line ConditionalExpression,CallExpression: → true spawns a real tsc build on import; → false and removing the call are no-ops under test since no test invokes the CLI path.
if (import.meta.main) runBuild().catch(reportFatalError)
