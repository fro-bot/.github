import type {ConfigSource, VersioningEngine} from './check-renovate-ranges.ts'
import type {RenovateRuntime} from './renovate-runtime.ts'
import {spawnSync} from 'node:child_process'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {basename, join, resolve} from 'node:path'
import process from 'node:process'
import {checkRenovateRanges, DEFAULT_CONFIG_FILES, reportRangeCheck} from './check-renovate-ranges.ts'
import {loadRenovateRuntime, readPinnedVersion, resolvePrefix} from './renovate-runtime.ts'

/**
 * CI gate for the Renovate preset this repository publishes (`default.json`) and the config that
 * consumes it (`.github/renovate.json5`).
 *
 * Two checks, both required:
 *
 * Renovate itself is not a repository dependency: it is installed at an exact, workflow-pinned
 * version into a scratch prefix and loaded from there (see renovate-runtime.ts).
 *
 *   1. `renovate-config-validator --strict --no-global` over the local configs and every
 *      version-pinned `github>` preset they extend. `--no-global` validates as repo config (the CLI
 *      default is global config). `--strict` fails on deprecated/removed options. The validator does
 *      NOT resolve `extends`, so a pinned preset is fetched at the exact ref `extends` names and
 *      validated as a file of its own.
 *   2. `check-renovate-ranges.ts` over the same files, because the validator never evaluates an
 *      `allowedVersions` string.
 *
 * Network: only pinned presets are fetched, over unauthenticated HTTPS from raw.githubusercontent.com.
 * A ref is the only input, so the same commit of this repository always validates the same bytes. A
 * preset that cannot be fetched is a FAILURE, never a skip. This is why the gate runs as its own CI
 * step instead of inside `bun run lint`, which is network-free.
 *
 * Presets with no `#ref` (floating default branch) and `local>` presets are not fetched: validating
 * a moving target would make the gate non-deterministic. They are listed in the output so the gap is
 * visible rather than implied. The same classification applies to the `extends` of every fetched
 * preset, so a floating ref behind a pinned preset is listed too, and a pinned one is fetched.
 */

const RAW_HOST = 'https://raw.githubusercontent.com'
const FETCH_ATTEMPTS = 3
const FETCH_TIMEOUT_MS = 20_000
const GITHUB_PRESET = /^github>(?<owner>[^/:#]+)\/(?<repo>[^/:#]+)(?::(?<name>[^#]+))?(?:#(?<ref>.+))?$/

export interface PinnedPreset {
  readonly spec: string
  readonly owner: string
  readonly repo: string
  readonly ref: string
  /** Candidate file names in the preset repository, in Renovate's lookup order. */
  readonly candidates: readonly string[]
}

export interface PresetClassification {
  readonly pinned: readonly PinnedPreset[]
  /** `github>` presets with no `#ref`; not validated. */
  readonly floating: readonly string[]
  /** `github>` presets in a shape this gate cannot resolve (fail closed): `//path`, or a `/` sub-preset selector. */
  readonly unsupported: readonly string[]
}

export type FetchText = (url: string) => Promise<{status: number; text: string}>

export interface ValidatorOutcome {
  readonly exitCode: number
  readonly output: string
}

export type RunValidator = (files: readonly string[], cwd: string) => ValidatorOutcome

export interface RenovateConfigCheckOptions {
  readonly rootDir: string
  /** Renovate's JSON5 parser (production: from the pinned install). */
  readonly parseConfig: (text: string) => unknown
  readonly engine: VersioningEngine
  readonly runValidator: RunValidator
  readonly localFiles?: readonly string[]
  readonly fetchText?: FetchText
}

export interface RenovateConfigCheckResult {
  readonly ok: boolean
  readonly validatorOk: boolean
  readonly rangesOk: boolean
  readonly fetchFailures: readonly string[]
  readonly floating: readonly string[]
  readonly unsupported: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const DEFAULT_PRESET_FILE = 'default'
const PRESET_FILE_EXTENSION = /\.json[5c]?$/

/**
 * The files Renovate's `fetchPreset` (`config/presets/util.ts`) reads for a `github>` preset, in
 * order. `default` (also the name when none is given) reads `default.json`, then `renovate.json`
 * when that does not exist. Any other name reads exactly one file: itself when it ends in `.json`,
 * `.json5` or `.jsonc`, else `<name>.json`. There is no `.json5` guessing. Names containing `/`
 * select a sub-preset inside the file and are rejected before this point (see `classifyExtends`).
 */
function candidateFiles(name: string | undefined): string[] {
  if (name === undefined || name === DEFAULT_PRESET_FILE) return ['default.json', 'renovate.json']
  return [PRESET_FILE_EXTENSION.test(name) ? name : `${name}.json`]
}

/** Sorts every `github>` entry of the configs' top-level `extends` into pinned, floating or unsupported. */
export function classifyExtends(configs: readonly unknown[]): PresetClassification {
  const pinned = new Map<string, PinnedPreset>()
  const floating = new Set<string>()
  const unsupported = new Set<string>()

  for (const config of configs) {
    const extendsList = isRecord(config) ? config.extends : undefined
    if (!Array.isArray(extendsList)) continue

    for (const entry of extendsList) {
      if (typeof entry !== 'string' || !entry.startsWith('github>')) continue
      const groups = GITHUB_PRESET.exec(entry)?.groups
      if (groups === undefined) {
        unsupported.add(entry)
        continue
      }
      const {owner, repo, name, ref} = groups
      // A `/` in the name selects a sub-preset inside the file. Resolving it would mean checking the
      // selected key exists in the fetched document; until then it fails the gate rather than
      // validating the containing file and ignoring the selector.
      if (owner === undefined || repo === undefined || name?.includes('/') === true) {
        unsupported.add(entry)
      } else if (ref === undefined) {
        floating.add(entry)
      } else {
        pinned.set(entry, {spec: entry, owner, repo, ref, candidates: candidateFiles(name)})
      }
    }
  }

  return {pinned: [...pinned.values()], floating: [...floating], unsupported: [...unsupported]}
}

export function rawUrl(preset: PinnedPreset, file: string): string {
  const ref = preset.ref.split('/').map(encodeURIComponent).join('/')
  return `${RAW_HOST}/${preset.owner}/${preset.repo}/${ref}/${file}`
}

/** Unauthenticated GET with a timeout; no credentials are ever attached. */
export const defaultFetchText: FetchText = async url => {
  const response = await fetch(url, {redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)})
  return {status: response.status, text: await response.text()}
}

async function fetchWithRetry(url: string, fetchText: FetchText): Promise<{status: number; text: string}> {
  let lastError = 'no attempt made'
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchText(url)
      // 404 is an answer (try the next candidate file); other statuses are retried as transient.
      if (response.status === 200 || response.status === 404) return response
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = errorMessage(error)
    }
  }
  throw new Error(`${url}: ${lastError} after ${FETCH_ATTEMPTS} attempts`)
}

export interface FetchedPreset {
  readonly preset: PinnedPreset
  readonly file: string
  readonly text: string
}

/** Fetches the first candidate file that exists at the pinned ref. Throws if none does. */
export async function fetchPinnedPreset(preset: PinnedPreset, fetchText: FetchText): Promise<FetchedPreset> {
  for (const file of preset.candidates) {
    const response = await fetchWithRetry(rawUrl(preset, file), fetchText)
    if (response.status === 200) return {preset, file, text: response.text}
  }
  throw new Error(`${preset.spec}: none of ${preset.candidates.join(', ')} exist at ref ${preset.ref}`)
}

/** Runs the validator entry module from the pinned install; `extraArgs` exists for failure proofs. */
export function runRenovateValidator(
  validatorPath: string,
  files: readonly string[],
  cwd: string,
  extraArgs: readonly string[] = [],
): ValidatorOutcome {
  const result = spawnSync(process.execPath, [validatorPath, '--strict', '--no-global', ...extraArgs, ...files], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const exitCode = result.status ?? 1
  const spawnError = result.error === undefined ? '' : `${errorMessage(result.error)}\n`
  return {exitCode, output: `${spawnError}${result.stdout}${result.stderr}`}
}

export async function checkRenovateConfig(options: RenovateConfigCheckOptions): Promise<RenovateConfigCheckResult> {
  const {
    rootDir,
    parseConfig,
    engine,
    runValidator,
    localFiles = DEFAULT_CONFIG_FILES,
    fetchText = defaultFetchText,
  } = options

  const localPaths = localFiles.map(file => resolve(rootDir, file))
  const sources: ConfigSource[] = []
  for (const [index, path] of localPaths.entries()) {
    sources.push({source: localFiles[index] ?? path, config: parseConfig(await readFile(path, 'utf8'))})
  }

  const classification = classifyExtends(sources.map(source => source.config))
  // A fetched preset's own `extends` is classified the same way, so a floating or unresolvable ref
  // behind a pinned preset is listed instead of hidden. `queue` grows while it is iterated.
  const queue = [...classification.pinned]
  const queued = new Set(queue.map(preset => preset.spec))
  const floating = new Set(classification.floating)
  const unsupported = new Set(classification.unsupported)
  const fetchFailures: string[] = []
  const scratch = await mkdtemp(join(tmpdir(), 'check-renovate-config-'))

  try {
    const validatorFiles = [...localPaths]

    for (const [index, preset] of queue.entries()) {
      try {
        const fetched = await fetchPinnedPreset(preset, fetchText)
        // One directory per preset: two presets can both be named `default.json`.
        const directory = join(scratch, String(index))
        await mkdir(directory)
        const path = join(directory, basename(fetched.file))
        await writeFile(path, fetched.text)
        validatorFiles.push(path)
        const config = parseConfig(fetched.text)
        sources.push({source: `${preset.owner}/${preset.repo}@${preset.ref}:${fetched.file}`, config})

        const nested = classifyExtends([config])
        for (const found of nested.pinned) {
          if (queued.has(found.spec)) continue
          queued.add(found.spec)
          queue.push(found)
        }
        for (const spec of nested.floating) floating.add(spec)
        for (const spec of nested.unsupported) unsupported.add(spec)
      } catch (error) {
        fetchFailures.push(errorMessage(error))
      }
    }

    const validator = runValidator(validatorFiles, rootDir)
    const validatorOk = validator.exitCode === 0
    if (validatorOk) {
      process.stdout.write(`check-renovate-config: validator passed for ${validatorFiles.length} file(s)\n`)
    } else {
      process.stderr.write(validator.output)
      process.stderr.write(`check-renovate-config: renovate-config-validator exited ${validator.exitCode}\n`)
    }

    const ranges = checkRenovateRanges(sources, engine)
    reportRangeCheck(ranges)

    for (const failure of fetchFailures) {
      process.stderr.write(`check-renovate-config: could not fetch or parse preset: ${failure}\n`)
    }
    for (const spec of unsupported) {
      process.stderr.write(`check-renovate-config: unsupported github preset shape, cannot validate: ${spec}\n`)
    }
    for (const spec of floating) {
      process.stdout.write(`check-renovate-config: not validated (no #ref, floating): ${spec}\n`)
    }

    return {
      ok: validatorOk && ranges.ok && fetchFailures.length === 0 && unsupported.size === 0,
      validatorOk,
      rangesOk: ranges.ok,
      fetchFailures,
      floating: [...floating],
      unsupported: [...unsupported],
    }
  } finally {
    await rm(scratch, {recursive: true, force: true})
  }
}

export async function main(): Promise<void> {
  const rootDir = process.cwd()
  let runtime: RenovateRuntime
  try {
    const version = await readPinnedVersion(rootDir)
    runtime = await loadRenovateRuntime(resolvePrefix(version), version)
  } catch (error) {
    // A missing or mismatched install is a gate failure with a plain message, not a stack trace.
    process.stderr.write(`check-renovate-config: ${errorMessage(error)}\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write(`check-renovate-config: using renovate ${runtime.version}\n`)

  const result = await checkRenovateConfig({
    rootDir,
    parseConfig: runtime.parseConfig,
    engine: runtime.versioning,
    runValidator: (files, cwd) => runRenovateValidator(runtime.validatorPath, files, cwd),
  })
  if (!result.ok) process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
