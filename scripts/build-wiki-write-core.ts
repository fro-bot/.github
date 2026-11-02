import {Buffer} from 'node:buffer'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {copyFile, cp, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from 'node:path'
import process from 'node:process'

import {GATE_CONTRACT_VERSION} from '../packages/wiki-write-core/src/gate-contract.ts'
import {verifyStagedPackage} from './verify-wiki-write-core-package.ts'

// Each of these is a function, not a top-level `const`: a module-level const initializer runs
// once per Stryker worker process (not per call), making its literal-segment mutants "static"
// and unobservable by per-test coverage attribution; a function body re-evaluates on every
// call, so each path segment carries an ordinary, per-call-killable mutant instead.
export function repositoryRoot(): string {
  return resolve(import.meta.dirname, '..')
}

export function packageDirectory(): string {
  return join(repositoryRoot(), 'packages', 'wiki-write-core')
}

export function sourceRoot(): string {
  return join(packageDirectory(), 'src')
}

/**
 * The one directory under the package that git tracks a file in: `gate-contract.json`, the marker
 * fro-bot/dashboard fetches from `main` over HTTP. Everything else a build produces is staged
 * outside the repository tree and never committed.
 */
export function markerDirectory(): string {
  return join(packageDirectory(), 'dist')
}

export function buildConfig(): string {
  return join(packageDirectory(), 'tsconfig.build.json')
}

export function packageManifest(): string {
  return join(packageDirectory(), 'package.json')
}

export function sourceHashPlaceholder(): string {
  return '__SOURCE_TREE_HASH__'
}

/** Whether the CLI was invoked with `--check` (verify the committed marker only, never write). Pure and testable in isolation. */
export function resolveCheckOnly(argv: readonly string[] = process.argv): boolean {
  return argv.includes('--check')
}

/** Whether the CLI was invoked with `--verify` (pack the staged package and prove its exports resolve). */
export function resolveVerify(argv: readonly string[] = process.argv): boolean {
  return argv.includes('--verify')
}

/** The directory following `--stage`, resolved against the working directory; `undefined` when the flag is absent. */
export function resolveStageRoot(argv: readonly string[] = process.argv): string | undefined {
  const index = argv.indexOf('--stage')
  if (index === -1) return undefined
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error('--stage requires a directory argument')
  }
  return resolve(value)
}

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
    'bunx',
    [
      '--no-install',
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

/**
 * The roots a stage directory may sit under: the OS temp directory, and `RUNNER_TEMP` when the
 * environment names an absolute one. A stage replaces whatever is at its target, so nothing outside
 * these roots (the checkout, a home directory, a tool install) is ever a valid target.
 */
export function stageRootAllowlist(
  env: Readonly<Record<string, string | undefined>> = process.env,
  tmp: string = tmpdir(),
): string[] {
  const runnerTemp = env.RUNNER_TEMP
  return runnerTemp !== undefined && isAbsolute(runnerTemp) ? [tmp, runnerTemp] : [tmp]
}

/**
 * The options a CLI invocation requests. `runBuild` never reads `process.argv` or the environment
 * itself: a build run stages and replaces directories, so what it writes to and where it may write
 * must come from the caller, never from ambient process state.
 */
export function cliOptions(
  argv: readonly string[] = process.argv,
  env: Readonly<Record<string, string | undefined>> = process.env,
): RunBuildOptions {
  return {
    allowedStageRoots: stageRootAllowlist(env),
    checkOnly: resolveCheckOnly(argv),
    stageRoot: resolveStageRoot(argv),
    verify: resolveVerify(argv),
  }
}

export interface RunBuildOptions {
  /** Roots a stage target must sit strictly under; defaults to the OS temp directory. */
  allowedStageRoots?: readonly string[]
  buildConfigPath?: string
  checkOnly?: boolean
  manifestPath?: string
  markerDirectory?: string
  removeDirectory?: typeof rm
  replaceDirectory?: typeof replaceDirectoryAtomically
  runTypeScriptBuild?: (outputDirectory: string) => void
  sourceRoot?: string
  stageRoot?: string
  verify?: boolean
  verifyPackage?: typeof verifyStagedPackage
  write?: (message: string) => void
}

/**
 * The assembled build flow the `import.meta.main` guard drives. The build always runs into a
 * temporary directory. The committed marker is then either rewritten from it or, with `checkOnly`,
 * compared against it. With `stageRoot` (or `verify`, which stages into a scratch directory) the
 * build is assembled into a publishable package directory, and `verify` packs that directory and
 * resolves every export of the resulting tarball. All I/O boundaries that would otherwise make this
 * unreachable outside a real CLI invocation are injectable: `runTypeScriptBuild` (default:
 * `runTypeScriptBuild`, which spawns real `tsc`), `verifyPackage` (default: `verifyStagedPackage`)
 * and every path default.
 */
export async function runBuild(options: RunBuildOptions = {}): Promise<void> {
  const currentSourceRoot = options.sourceRoot ?? sourceRoot()
  const currentMarkerDirectory = options.markerDirectory ?? markerDirectory()
  const currentBuildConfig = options.buildConfigPath ?? buildConfig()
  const currentManifest = options.manifestPath ?? packageManifest()
  const currentCheckOnly = options.checkOnly ?? false
  const currentVerify = options.verify ?? false
  const buildTypeScript = options.runTypeScriptBuild ?? runTypeScriptBuild
  const replaceDirectory = options.replaceDirectory ?? replaceDirectoryAtomically
  const removeDirectory = options.removeDirectory ?? rm
  const verifyPackage = options.verifyPackage ?? verifyStagedPackage
  const write = options.write ?? writeToStdout

  const temporaryRoot = await mkdtemp(join(dirname(currentMarkerDirectory), '.wiki-write-core-dist-'))
  let scratchStageRoot: string | undefined

  try {
    if (await pathExists(currentMarkerDirectory)) {
      await collectFiles(currentMarkerDirectory)
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

    const freshMarker = await readFile(join(temporaryRoot, 'gate-contract.json'))
    const committedMarkerPath = join(currentMarkerDirectory, 'gate-contract.json')
    if (currentCheckOnly) {
      const committedMarker = await readFileIfPresent(committedMarkerPath)
      if (committedMarker === undefined || !committedMarker.equals(freshMarker)) {
        throw new Error(
          `wiki-write-core gate-contract marker is stale: ${displayPath(committedMarkerPath)} differs from a fresh build; run \`bun run build\` and commit it`,
        )
      }
      write('wiki-write-core gate-contract marker is up to date\n')
    } else {
      await mkdir(currentMarkerDirectory, {recursive: true})
      await writeFile(committedMarkerPath, freshMarker)
    }

    let stageRoot = options.stageRoot
    const allowedStageRoots = [...(options.allowedStageRoots ?? [tmpdir()])]
    if (stageRoot === undefined && currentVerify) {
      scratchStageRoot = await mkdtemp(join(tmpdir(), 'wiki-write-core-stage-'))
      stageRoot = join(scratchStageRoot, 'package')
      allowedStageRoots.push(scratchStageRoot)
    }
    if (stageRoot !== undefined) {
      await stagePackage({
        allowedStageRoots,
        builtRoot: temporaryRoot,
        manifestPath: currentManifest,
        replaceDirectory,
        stageRoot,
      })
      if (currentVerify) {
        const verification = await verifyPackage(stageRoot)
        write(
          `wiki-write-core package verified: ${verification.subpaths.length} export subpaths, ${verification.files.length} tarball files\n`,
        )
      }
    }
  } finally {
    await removeDirectory(temporaryRoot, {force: true, recursive: true})
    // `force` is deliberately omitted: `mkdtemp` just created the scratch directory and only this
    // call removes it, so a missing one would be a bug to surface, not an absence to tolerate.
    if (scratchStageRoot !== undefined) {
      await removeDirectory(scratchStageRoot, {recursive: true})
    }
  }
}

function writeToStdout(message: string): void {
  process.stdout.write(message)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function reportFatalError(error: unknown): void {
  process.stderr.write(`${errorMessage(error)}\n`)
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
  updateHash(hash, 'package/exports', stableJson(publishedExports(manifest.exports)))
  updateHash(hash, 'package/files', stableJson([...manifest.files].sort((left, right) => left.localeCompare(right))))

  return hash.digest('hex')
}

export function resolveBuildConfig(configPath: string, options: {spawn?: typeof execFileSync} = {}): unknown {
  const spawn = options.spawn ?? execFileSync
  const resolvedConfig = spawn(
    'bunx',
    ['--no-install', 'tsc', '--showConfig', '--project', configPath, '--pretty', 'false'],
    {
      cwd: repositoryRoot(),
      encoding: 'utf8',
    },
  )
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

/**
 * The `exports` map the published tarball carries. The committed manifest points every subpath at
 * `./src/<name>.ts`; the tarball points it at the compiled `./dist/<name>.js` with its declaration
 * file. Any other value (`./package.json`, an already-conditional entry) passes through untouched.
 */
export function publishedExports(exportsField: unknown): unknown {
  if (!isRecord(exportsField)) return exportsField
  return Object.fromEntries(
    Object.entries(exportsField).map(([subpath, target]) => {
      const match = typeof target === 'string' ? /^\.\/src\/([^/]+)\.ts$/u.exec(target) : null
      if (match === null) return [subpath, target]
      const name = match[1]
      return [subpath, {types: `./dist/${name}.d.ts`, import: `./dist/${name}.js`}]
    }),
  )
}

/** The `package.json` text the tarball carries: the committed manifest with `exports` rewritten to `dist`. */
export function publishedManifest(content: string, path: string): string {
  const parsed: unknown = JSON.parse(content)
  if (!isRecord(parsed) || !('exports' in parsed)) {
    throw new Error(`package manifest must define exports: ${displayPath(path)}`)
  }
  return `${JSON.stringify({...parsed, exports: publishedExports(parsed.exports)}, null, 2)}\n`
}

interface StagePackageOptions {
  /** Roots the stage target must sit strictly under, after resolving symlinks. */
  allowedStageRoots: readonly string[]
  builtRoot: string
  manifestPath: string
  replaceDirectory?: typeof replaceDirectoryAtomically
  stageRoot: string
}

// A function, not a top-level `const`, for the Stryker reason given above `repositoryRoot`.
export function stageMarkerName(): string {
  return 'wiki-write-core-stage.marker'
}

export function stageMarkerContent(): string {
  return '@fro.bot/wiki-write-core staged package\n'
}

/** `path` with every symlink resolved, including for the part of it that does not exist yet. */
async function canonicalPath(path: string): Promise<string> {
  const absolute = resolve(path)
  try {
    return await realpath(absolute)
  } catch (error: unknown) {
    if (!isFileNotFoundError(error)) throw error
  }
  // `realpath` also reports ENOENT for a symlink whose target is missing; creating anything below
  // it would create that target, wherever it points.
  if (await pathExists(absolute)) throw new Error(`refusing to follow a dangling symlink at ${absolute}`)
  return join(await canonicalPath(dirname(absolute)), basename(absolute))
}

function isStrictlyInside(root: string, path: string): boolean {
  const relation = relative(root, path)
  return relation !== '' && relation.split(sep)[0] !== '..' && !isAbsolute(relation)
}

async function hasStageMarker(directory: string): Promise<boolean> {
  const markerPath = join(directory, stageMarkerName())
  try {
    return (await lstat(markerPath)).isFile() && (await readFile(markerPath, 'utf8')) === stageMarkerContent()
  } catch (error: unknown) {
    if (isFileNotFoundError(error) || isNotDirectoryError(error)) return false
    throw error
  }
}

/**
 * The canonical stage target, or a refusal. A stage replaces whatever sits at its target, so the
 * target must resolve (through symlinked ancestors too) to somewhere strictly under an allowed
 * root, and an existing target is replaced only when a previous stage left its marker there.
 * Nothing is created, moved or removed before this returns.
 */
async function checkedStageTarget(stageRoot: string, allowedStageRoots: readonly string[]): Promise<string> {
  const target = await canonicalPath(stageRoot)
  const roots = await Promise.all(allowedStageRoots.map(async root => canonicalPath(root)))
  if (!roots.some(root => isStrictlyInside(root, target))) {
    throw new Error(`refusing to stage into ${stageRoot}: it is outside the allowed staging roots`)
  }
  if ((await pathExists(target)) && !(await hasStageMarker(target))) {
    throw new Error(`refusing to replace ${stageRoot}: it has no stage marker from a previous stage`)
  }
  return target
}

/**
 * Assembles the publishable package in `stageRoot`: the built `dist/`, the rewritten manifest, the
 * README and LICENSE that sit beside the committed manifest, and the stage marker that lets a later
 * stage replace this one. The committed tree is never modified; `npm pack` and `npm publish` run
 * from `stageRoot`.
 */
export async function stagePackage(options: StagePackageOptions): Promise<void> {
  const replaceDirectory = options.replaceDirectory ?? replaceDirectoryAtomically
  const sourceDirectory = dirname(options.manifestPath)
  const target = await checkedStageTarget(options.stageRoot, options.allowedStageRoots)
  await mkdir(dirname(target), {recursive: true})
  const stagingRoot = await mkdtemp(join(dirname(target), '.wiki-write-core-stage-'))

  try {
    await cp(options.builtRoot, join(stagingRoot, 'dist'), {recursive: true})
    await writeFile(
      join(stagingRoot, 'package.json'),
      publishedManifest((await readFile(options.manifestPath)).toString(), options.manifestPath),
    )
    await copyFile(join(sourceDirectory, 'README.md'), join(stagingRoot, 'README.md'))
    await copyFile(join(sourceDirectory, 'LICENSE.md'), join(stagingRoot, 'LICENSE.md'))
    await writeFile(join(stagingRoot, stageMarkerName()), stageMarkerContent())
    await replaceDirectory(stagingRoot, target)
  } finally {
    await rm(stagingRoot, {force: true, recursive: true})
  }
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
      try {
        await renameDirectory(backup, target)
      } catch (restoreError: unknown) {
        // The backup is the only copy of the original now: keep it and say where it is.
        throw new AggregateError(
          [error, restoreError],
          `could not install the replacement (${errorMessage(error)}) and could not restore the original (${errorMessage(restoreError)}); the original is kept at ${backup}`,
        )
      }
    }
    throw error
  }

  // Only a replacement that is in place makes the backup disposable.
  if (targetMoved) {
    await rm(backup, {recursive: true})
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

async function readFileIfPresent(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path)
  } catch (error: unknown) {
    if (isFileNotFoundError(error)) return undefined
    throw error
  }
}

function displayPath(path: string): string {
  return relative(repositoryRoot(), path).split(sep).join('/') || path
}

export function isFileNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

export function isNotDirectoryError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOTDIR'
}

// Deliberately use Node's main-module check: unlike the repository's legacy scripts, it survives
// symlinks and spaces in paths without reconstructing a file URL from argv[1].
// Stryker disable next-line ConditionalExpression,CallExpression: → true spawns a real tsc build on import; → false and removing a call are no-ops under test since no test invokes the CLI path.
if (import.meta.main) runBuild(cliOptions()).catch(reportFatalError)
