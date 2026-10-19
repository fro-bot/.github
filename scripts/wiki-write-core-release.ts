import {execFileSync, spawnSync} from 'node:child_process'
import {appendFileSync} from 'node:fs'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import process from 'node:process'
import {pathToFileURL} from 'node:url'
import {format} from 'node:util'

import {parse as parseYaml} from 'yaml'

/**
 * Release decision for `@fro.bot/wiki-write-core`.
 *
 * semantic-release sees every commit since the last tag, so it cannot scope a release to one
 * package of this repository. This module does the scoping in the credential-free `decide` job of
 * `.github/workflows/release-wiki-write-core.yaml`: it takes the highest `wiki-write-core-v*` tag
 * merged into the ref as the base, keeps the commits since that tag that changed a path under
 * `packages/wiki-write-core/` (minus `[skip release]` commits), and runs the configured
 * `@semantic-release/commit-analyzer` and `@semantic-release/release-notes-generator` over only
 * those commits. The type, version and base tag go out as job outputs; the notes go to a file.
 *
 * Release tools are NOT dependencies of this repository: their transitive tree carries advisories
 * with no published fix, which `bun run lint` (`check:override-floors`) fails on. One exact version of
 * each is installed into a scratch prefix outside the repo (`install`), and the two plugins are
 * loaded from there. The versions are declared in the top-level `env` of a workflow file, each with a
 * `# renovate: datasource=npm depName=...` comment that the inherited bfra-me regex manager keeps
 * current; this module reads them from the file so local runs and CI cannot disagree.
 */

export const PACKAGE_PATH_PREFIX = 'packages/wiki-write-core/'
export const TAG_PREFIX = 'wiki-write-core-v'
export const RELEASERC_FILE = 'packages/wiki-write-core/.releaserc.yaml'
export const TOOLS_WORKFLOW_FILE = '.github/workflows/release-wiki-write-core.yaml'
export const PREFIX_ENV = 'WIKI_WRITE_CORE_RELEASE_PREFIX'

/** The semantic-release `tagFormat` template that produces `TAG_PREFIX` tags. */
export const TAG_FORMAT = `${TAG_PREFIX}\${version}`
const EXACT_VERSION = /^\d+\.\d+\.\d+$/u
const TAG_PATTERN = /^wiki-write-core-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u
const SKIP_RELEASE_PATTERN = /\[skip release\]|\[release skip\]/iu
const COMMIT_HASH_PATTERN = /^[0-9a-f]{40,64}$/u

/** The release tools, in install order, with the workflow `env` key that pins each. */
export const RELEASE_TOOLS = [
  {name: 'semantic-release', versionKey: 'SEMANTIC_RELEASE_VERSION'},
  {name: '@semantic-release/exec', versionKey: 'SEMANTIC_RELEASE_EXEC_VERSION'},
  {name: '@semantic-release/npm', versionKey: 'SEMANTIC_RELEASE_NPM_VERSION'},
  {name: '@semantic-release/github', versionKey: 'SEMANTIC_RELEASE_GITHUB_VERSION'},
  {name: '@semantic-release/commit-analyzer', versionKey: 'SEMANTIC_RELEASE_COMMIT_ANALYZER_VERSION'},
  {name: '@semantic-release/release-notes-generator', versionKey: 'SEMANTIC_RELEASE_NOTES_GENERATOR_VERSION'},
  {
    name: 'conventional-changelog-conventionalcommits',
    versionKey: 'CONVENTIONAL_CHANGELOG_CONVENTIONALCOMMITS_VERSION',
  },
  {name: 'conventional-changelog-writer', versionKey: 'CONVENTIONAL_CHANGELOG_WRITER_VERSION'},
] as const

/**
 * `@semantic-release/release-notes-generator` depends on `conventional-changelog-writer` ^8, which the
 * `conventionalcommits` 10 preset rejects; the manifest pins writer 9 both directly and as an override.
 */
const WRITER_NAME = 'conventional-changelog-writer'

export type ReleaseTool = (typeof RELEASE_TOOLS)[number]['name']
export type ToolPins = Readonly<Record<ReleaseTool, string>>
export type ReleaseType = 'major' | 'minor' | 'patch'

export interface ReleaseCommit {
  readonly hash: string
  readonly message: string
  readonly committerDate: string
  /** Every path the commit changed relative to its first parent, renames reported as delete plus add. */
  readonly paths: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// -- base tag and version arithmetic ---------------------------------------------------------------

function parseTagVersion(tag: string): readonly [number, number, number] | undefined {
  const match = TAG_PATTERN.exec(tag)
  if (match === null) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compareVersions(left: readonly number[], right: readonly number[]): number {
  for (const [index, part] of left.entries()) {
    const difference = part - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/**
 * The highest-semver release tag, or `undefined` when none qualifies. Compares numerically, so the
 * order in which tags were created is irrelevant and `0.10.0` outranks `0.2.0`. Prerelease, build
 * metadata, leading-zero and otherwise malformed tags are not release tags.
 */
export function selectBaseTag(tags: readonly string[]): string | undefined {
  let best: {tag: string; version: readonly [number, number, number]} | undefined
  for (const tag of tags) {
    const version = parseTagVersion(tag)
    if (version === undefined) continue
    if (best === undefined || compareVersions(version, best.version) > 0) best = {tag, version}
  }
  return best?.tag
}

export function incrementVersion(version: string, type: ReleaseType): string {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number)
  if (type === 'major') {
    if (major === 0) throw new Error('a 0.x package does not release a major version')
    return `${major + 1}.0.0`
  }
  if (type === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

// -- commit selection ------------------------------------------------------------------------------

/**
 * The commits that count toward a release: those that changed a path under the package directory and
 * are not marked `[skip release]` / `[release skip]` (the rule semantic-release applies itself).
 */
export function filterPackageCommits(commits: readonly ReleaseCommit[]): ReleaseCommit[] {
  return commits.filter(
    commit =>
      !SKIP_RELEASE_PATTERN.test(commit.message) && commit.paths.some(path => path.startsWith(PACKAGE_PATH_PREFIX)),
  )
}

/** Runs `git` with `args` and returns stdout; throws on a non-zero exit. */
export type Git = (args: readonly string[]) => string

export const runGit: Git = args => {
  try {
    return execFileSync('git', [...args], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const stderr = isRecord(error) && typeof error.stderr === 'string' ? error.stderr.trim() : ''
    throw new Error(`git ${args.join(' ')} failed: ${stderr === '' ? errorMessage(error) : stderr}`, {cause: error})
  }
}

/** The release tags reachable from `ref`, which is what bounds the base tag to the branch history. */
export function listMergedTags(git: Git, ref: string): string[] {
  return git(['tag', '--merged', ref, '--list', `${TAG_PREFIX}*`])
    .split('\n')
    .filter(tag => tag !== '')
}

/**
 * Every commit in `baseTag..ref`, newest first, with the paths each changed against its first parent.
 * Throws when a commit's paths cannot be read: a commit with unknown paths must not silently drop out.
 */
export function readCommitsSince(git: Git, baseTag: string, ref: string): ReleaseCommit[] {
  const hashes = git(['rev-list', `${baseTag}..${ref}`, '--'])
    .split('\n')
    .filter(hash => hash !== '')
  return hashes.map(hash => {
    if (!COMMIT_HASH_PATTERN.test(hash)) throw new Error(`git rev-list returned an unexpected commit id: ${hash}`)
    const [committerDate = '', ...messageLines] = git(['log', '-1', '--format=%cI%n%B', hash]).split('\n')
    let paths: string[]
    try {
      paths = git(['diff', '--name-only', '--no-renames', '-z', `${hash}^1`, hash, '--'])
        .split('\0')
        .filter(path => path !== '')
    } catch (error) {
      throw new Error(`cannot read the changed paths of commit ${hash}: ${errorMessage(error)}`, {cause: error})
    }
    return {hash, message: messageLines.join('\n').trimEnd(), committerDate, paths}
  })
}

// -- release policy --------------------------------------------------------------------------------

export type Releaserc = Readonly<Record<string, unknown>>

/** Parses `.releaserc.yaml` and checks the fields this module relies on. */
export function parseReleaserc(text: string): Releaserc {
  const document: unknown = parseYaml(text)
  if (!isRecord(document)) throw new TypeError(`${RELEASERC_FILE} must contain a mapping at the top level`)
  if (document.tagFormat !== TAG_FORMAT) {
    throw new TypeError(
      `${RELEASERC_FILE}: tagFormat must be ${JSON.stringify(TAG_FORMAT)}, got ${JSON.stringify(document.tagFormat)}`,
    )
  }
  if (!Array.isArray(document.branches) || document.branches.length === 0) {
    throw new TypeError(`${RELEASERC_FILE}: branches must be a non-empty list`)
  }
  return document
}

/**
 * semantic-release hands each plugin the global options merged with the step's own options; a
 * step key holding a plain object (`analyzeCommits: {releaseRules}`) is merged into that step's plugin.
 */
function pluginConfig(releaserc: Releaserc, step: 'analyzeCommits' | 'generateNotes'): Record<string, unknown> {
  const shared = Object.fromEntries(
    Object.entries(releaserc).filter(([key]) => !['plugins', 'analyzeCommits', 'generateNotes'].includes(key)),
  )
  const own = releaserc[step]
  return {...shared, ...(isRecord(own) ? own : {})}
}

// -- decision --------------------------------------------------------------------------------------

export interface PluginLogger {
  log: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  success: (...args: unknown[]) => void
}

export interface PluginCommit {
  readonly hash: string
  readonly message: string
  readonly committerDate: string
}

export interface PluginContext {
  readonly cwd: string
  readonly logger: PluginLogger
  readonly commits: readonly PluginCommit[]
  readonly options?: {readonly repositoryUrl: string}
  readonly lastRelease?: {readonly version: string; readonly gitTag: string; readonly gitHead: string}
  readonly nextRelease?: {readonly version: string; readonly gitTag: string; readonly gitHead: string}
}

export type PluginStep = (config: Record<string, unknown>, context: PluginContext) => Promise<unknown>

export interface ReleasePlugins {
  readonly analyzeCommits: PluginStep
  readonly generateNotes: PluginStep
}

export type Decision =
  | {
      readonly release: false
      readonly baseTag: string
      readonly baseVersion: string
      readonly commits: readonly ReleaseCommit[]
    }
  | {
      readonly release: true
      readonly type: ReleaseType
      readonly version: string
      readonly baseTag: string
      readonly baseVersion: string
      readonly commits: readonly ReleaseCommit[]
      readonly notes: string
    }

export interface DecideOptions {
  readonly git: Git
  readonly ref: string
  readonly releaserc: Releaserc
  readonly plugins: ReleasePlugins
  readonly repositoryUrl: string
  /** Directory the plugins resolve presets from: the scratch prefix that holds them. */
  readonly cwd: string
  readonly logger: PluginLogger
}

function asReleaseType(value: unknown): ReleaseType | undefined {
  if (value === null || value === undefined) return undefined
  if (value === 'major' || value === 'minor' || value === 'patch') return value
  throw new TypeError(`commit-analyzer returned an unexpected release type: ${JSON.stringify(value)}`)
}

export async function decideRelease(options: DecideOptions): Promise<Decision> {
  const {git, ref, releaserc, plugins, repositoryUrl, cwd, logger} = options

  const baseTag = selectBaseTag(listMergedTags(git, ref))
  if (baseTag === undefined) {
    throw new Error(
      `no ${TAG_PREFIX}* release tag is reachable from ${ref}; refusing to decide a release without a base tag`,
    )
  }
  const baseVersion = baseTag.slice(TAG_PREFIX.length)

  const commits = filterPackageCommits(readCommitsSince(git, baseTag, ref))
  const pluginCommits = commits.map(({hash, message, committerDate}) => ({hash, message, committerDate}))

  const type =
    commits.length === 0
      ? undefined
      : asReleaseType(
          await plugins.analyzeCommits(pluginConfig(releaserc, 'analyzeCommits'), {
            cwd,
            commits: pluginCommits,
            logger,
          }),
        )
  if (type === undefined) return {release: false, baseTag, baseVersion, commits}

  const version = incrementVersion(baseVersion, type)
  const notes = await plugins.generateNotes(pluginConfig(releaserc, 'generateNotes'), {
    cwd,
    commits: pluginCommits,
    logger,
    options: {repositoryUrl},
    lastRelease: {version: baseVersion, gitTag: baseTag, gitHead: git(['rev-parse', `${baseTag}^{commit}`]).trim()},
    nextRelease: {version, gitTag: `${TAG_PREFIX}${version}`, gitHead: git(['rev-parse', `${ref}^{commit}`]).trim()},
  })
  if (typeof notes !== 'string' || notes.trim() === '') {
    throw new TypeError('release-notes-generator returned no notes for a releasable decision')
  }
  return {release: true, type, version, baseTag, baseVersion, commits, notes}
}

/** The `$GITHUB_OUTPUT` lines for a decision. `type=none` means nothing to release. */
export function formatGithubOutput(decision: Decision): string {
  return decision.release
    ? `type=${decision.type}\nversion=${decision.version}\nbase-tag=${decision.baseTag}\n`
    : `type=none\nversion=\nbase-tag=${decision.baseTag}\n`
}

// -- release tools: pins, scratch install, plugin loading ------------------------------------------

/** Extracts every tool pin from the top-level `env` of a workflow file's text; throws unless each is exact. */
export function parseToolPins(workflowText: string, source: string): ToolPins {
  const document: unknown = parseYaml(workflowText)
  const env = isRecord(document) ? document.env : undefined
  const pins: Record<string, string> = {}
  for (const {name, versionKey} of RELEASE_TOOLS) {
    const version = isRecord(env) ? env[versionKey] : undefined
    if (typeof version !== 'string' || !EXACT_VERSION.test(version)) {
      throw new TypeError(
        `${source}: top-level env.${versionKey} must be an exact x.y.z version string, got ${JSON.stringify(version)}`,
      )
    }
    pins[name] = version
  }
  return pins as ToolPins
}

/** `WIKI_WRITE_CORE_RELEASE_PREFIX` when set, else a directory under the runner temp dir. */
export function resolvePrefix(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env[PREFIX_ENV]
  if (explicit !== undefined && explicit !== '') return explicit
  return join(env.RUNNER_TEMP ?? tmpdir(), 'wiki-write-core-release-tools')
}

/** The scratch `package.json`: exact direct pins plus the writer override that matches its direct pin. */
export function buildToolManifest(pins: ToolPins): string {
  return `${JSON.stringify(
    {
      name: 'wiki-write-core-release-tools',
      private: true,
      dependencies: Object.fromEntries(RELEASE_TOOLS.map(({name}) => [name, pins[name]])),
      overrides: {[WRITER_NAME]: pins[WRITER_NAME]},
    },
    null,
    2,
  )}\n`
}

async function readInstalledVersion(prefix: string, name: string): Promise<string | undefined> {
  try {
    const manifest: unknown = JSON.parse(await readFile(join(prefix, 'node_modules', name, 'package.json'), 'utf8'))
    return isRecord(manifest) && typeof manifest.version === 'string' ? manifest.version : undefined
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

/** Fails loudly unless `prefix` holds exactly the pinned version of every release tool. */
export async function assertToolsInstalled(prefix: string, pins: ToolPins): Promise<void> {
  for (const {name} of RELEASE_TOOLS) {
    const installed = await readInstalledVersion(prefix, name)
    if (installed === undefined) {
      throw new Error(
        `${name} is not installed under ${PREFIX_ENV}=${prefix}. Run \`node scripts/wiki-write-core-release.ts install\` first.`,
      )
    }
    if (installed !== pins[name]) {
      throw new Error(
        `${name} under ${prefix} is ${installed} but the workflow pins ${pins[name]}. Re-run \`node scripts/wiki-write-core-release.ts install\`.`,
      )
    }
  }
}

export interface InstallCommand {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
}

export type RunInstall = (command: InstallCommand) => {status: number | null; error?: Error | undefined}

const runInstallCommand: RunInstall = ({command, args, cwd}) =>
  // stdout is reserved for the prefix path; install progress goes to stderr.
  spawnSync(command, [...args], {cwd, stdio: ['ignore', process.stderr, process.stderr]})

/** Release-age floor for the scratch install, in seconds (3 days). */
const MINIMUM_RELEASE_AGE_SECONDS = 259_200

/**
 * Installs the pinned tools into `prefix` with lifecycle scripts off. `cwd` is the prefix itself and
 * `--no-save` keeps Bun from writing a lockfile, so the repository's `package.json` and
 * `bun.lock` are never touched. `--minimum-release-age` refuses any package version published
 * less than 3 days ago, transitive dependencies included.
 */
export async function installReleaseTools(
  prefix: string,
  pins: ToolPins,
  run: RunInstall = runInstallCommand,
): Promise<'already-installed' | 'installed'> {
  try {
    await assertToolsInstalled(prefix, pins)
    return 'already-installed'
  } catch {
    // Missing or different versions: fall through to a fresh install.
  }

  await mkdir(prefix, {recursive: true})
  await writeFile(join(prefix, 'package.json'), buildToolManifest(pins))
  const result = run({
    command: 'bun',
    args: ['install', `--minimum-release-age=${MINIMUM_RELEASE_AGE_SECONDS}`, '--ignore-scripts', '--no-save'],
    cwd: prefix,
  })
  if (result.error !== undefined) throw new Error(`bun install failed to start: ${errorMessage(result.error)}`)
  if (result.status !== 0) throw new Error(`bun install exited ${String(result.status)}`)
  // The explicit post-condition: bun exiting 0 is not proof the pinned versions landed.
  await assertToolsInstalled(prefix, pins)
  return 'installed'
}

function pickFunction(source: unknown, name: string, origin: string): PluginStep {
  const candidate = isRecord(source) ? source[name] : undefined
  if (typeof candidate !== 'function') throw new TypeError(`${origin} does not export a function named ${name}`)
  return candidate as PluginStep
}

/** Loads the two semantic-release plugins from the scratch prefix. Fails unless the pinned install is present. */
export async function loadReleasePlugins(prefix: string, pins: ToolPins): Promise<ReleasePlugins> {
  await assertToolsInstalled(prefix, pins)
  const requireFromPrefix = createRequire(join(prefix, 'package.json'))
  const analyzer: unknown = await import(
    pathToFileURL(requireFromPrefix.resolve('@semantic-release/commit-analyzer')).href
  )
  const notes: unknown = await import(
    pathToFileURL(requireFromPrefix.resolve('@semantic-release/release-notes-generator')).href
  )
  return {
    analyzeCommits: pickFunction(analyzer, 'analyzeCommits', '@semantic-release/commit-analyzer'),
    generateNotes: pickFunction(notes, 'generateNotes', '@semantic-release/release-notes-generator'),
  }
}

// -- CLI -------------------------------------------------------------------------------------------

/** Plugins log printf-style (`logger.log('Analyzing commit: %s', message)`), so route through `util.format`. */
function writeLog(...args: unknown[]): void {
  process.stderr.write(`${format(...args)}\n`)
}

const stderrLogger: PluginLogger = {log: writeLog, warn: writeLog, error: writeLog, success: writeLog}

interface CliArguments {
  readonly command: string
  readonly flags: ReadonlyMap<string, string>
}

const FLAGS_BY_COMMAND: Readonly<Record<string, readonly string[]>> = {
  install: ['--workflow'],
  decide: ['--workflow', '--notes', '--ref'],
}

function parseArguments(argv: readonly string[]): CliArguments {
  const [command = '', ...rest] = argv
  const allowed = FLAGS_BY_COMMAND[command]
  if (allowed === undefined)
    throw new Error(`usage: wiki-write-core-release.ts <${Object.keys(FLAGS_BY_COMMAND).join('|')}> [flags]`)
  const flags = new Map<string, string>()
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index] ?? ''
    const value = rest[index + 1]
    if (!allowed.includes(flag)) throw new Error(`${command}: unknown argument ${JSON.stringify(flag)}`)
    if (value === undefined) throw new Error(`${command}: ${flag} requires a value`)
    flags.set(flag, value)
  }
  return {command, flags}
}

function logDecision(decision: Decision): void {
  const lines = [
    `wiki-write-core-release: base ${decision.baseTag}, ${decision.commits.length} package commit(s) since`,
  ]
  for (const commit of decision.commits)
    lines.push(`  ${commit.hash.slice(0, 7)} ${commit.message.split('\n')[0] ?? ''}`)
  lines.push(
    decision.release
      ? `wiki-write-core-release: ${decision.type} release ${decision.version}`
      : 'wiki-write-core-release: no release',
  )
  process.stderr.write(`${lines.join('\n')}\n`)
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  try {
    const {command, flags} = parseArguments(argv)
    const workflowFile = flags.get('--workflow') ?? TOOLS_WORKFLOW_FILE
    const pins = parseToolPins(await readFile(workflowFile, 'utf8'), workflowFile)
    const prefix = resolvePrefix(env)

    if (command === 'install') {
      const outcome = await installReleaseTools(prefix, pins)
      process.stderr.write(`wiki-write-core-release: release tools ${outcome} at ${prefix}\n`)
      process.stdout.write(`${prefix}\n`)
      return
    }

    const notesFile = flags.get('--notes')
    if (notesFile === undefined) throw new Error('decide: --notes <path> is required')
    const ref = flags.get('--ref') ?? 'HEAD'
    const decision = await decideRelease({
      git: runGit,
      ref,
      releaserc: parseReleaserc(await readFile(RELEASERC_FILE, 'utf8')),
      plugins: await loadReleasePlugins(prefix, pins),
      repositoryUrl: runGit(['remote', 'get-url', 'origin']).trim(),
      cwd: prefix,
      logger: stderrLogger,
    })
    logDecision(decision)
    if (decision.release) {
      await mkdir(dirname(notesFile), {recursive: true})
      await writeFile(notesFile, `${decision.notes.trimEnd()}\n`)
    }
    const githubOutput = env.GITHUB_OUTPUT
    if (githubOutput !== undefined && githubOutput !== '') appendFileSync(githubOutput, formatGithubOutput(decision))
    process.stdout.write(formatGithubOutput(decision))
  } catch (error) {
    process.stderr.write(`wiki-write-core-release: ${errorMessage(error)}\n`)
    process.exitCode = 1
  }
}

if (import.meta.main) {
  await main()
}
