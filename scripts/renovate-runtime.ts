import type {VersioningEngine} from './check-renovate-ranges.ts'

import {spawnSync} from 'node:child_process'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {pathToFileURL} from 'node:url'

import {parse as parseYaml} from 'yaml'

/**
 * Locates, installs and loads the Renovate used by the preset gate.
 *
 * Renovate is deliberately NOT a dependency of this repository: its transitive tree brings
 * advisories with no published fix (`braces`, `sprintf-js`) into `bun audit`, which `bun run lint`
 * (`check:override-floors`) fails on. Instead one exact version is installed into a scratch
 * prefix outside the repo at check time (`bun install` in the prefix, no lockfile written) and every
 * Renovate module is resolved from there.
 *
 * The version is declared in exactly one place: the workflow-level `env.RENOVATE_VERSION` of
 * `.github/workflows/main.yaml`, carrying a `# renovate: datasource=npm depName=renovate` comment
 * that the inherited `bfra-me/renovate-config` regex manager ("Update `version` and `_VERSION`
 * values in GitHub Actions and workflows") picks up, so Renovate keeps its own pin current.
 * Scripts read that value from the file rather than from the environment, so local runs and CI
 * cannot disagree about it.
 */

export const WORKFLOW_FILE = '.github/workflows/main.yaml'
export const VERSION_KEY = 'RENOVATE_VERSION'
export const PREFIX_ENV = 'RENOVATE_PREFIX'

const EXACT_VERSION = /^\d+\.\d+\.\d+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Extracts the pinned Renovate version from the text of `main.yaml`; throws unless it is exact. */
export function parsePinnedVersion(workflowText: string): string {
  const document: unknown = parseYaml(workflowText)
  const env = isRecord(document) ? document.env : undefined
  const version = isRecord(env) ? env[VERSION_KEY] : undefined
  if (typeof version !== 'string' || !EXACT_VERSION.test(version)) {
    throw new TypeError(
      `${WORKFLOW_FILE}: top-level env.${VERSION_KEY} must be an exact x.y.z version string, got ${JSON.stringify(version)}`,
    )
  }
  return version
}

export async function readPinnedVersion(rootDir: string): Promise<string> {
  return parsePinnedVersion(await readFile(join(rootDir, WORKFLOW_FILE), 'utf8'))
}

/** `RENOVATE_PREFIX` when set, else a per-version directory under the runner temp dir. */
export function resolvePrefix(version: string, env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env[PREFIX_ENV]
  if (explicit !== undefined && explicit !== '') return explicit
  return join(env.RUNNER_TEMP ?? tmpdir(), `renovate-${version}`)
}

function packageDirectory(prefix: string): string {
  return join(prefix, 'node_modules', 'renovate')
}

/** The version installed under `prefix`, or `undefined` when nothing is installed there. */
export async function readInstalledVersion(prefix: string): Promise<string | undefined> {
  try {
    const manifest: unknown = JSON.parse(await readFile(join(packageDirectory(prefix), 'package.json'), 'utf8'))
    return isRecord(manifest) && typeof manifest.version === 'string' ? manifest.version : undefined
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

/** Fails loudly unless `prefix` holds exactly the pinned Renovate. Returns the package directory. */
export async function assertRenovateInstalled(prefix: string, version: string): Promise<string> {
  const installed = await readInstalledVersion(prefix)
  if (installed === undefined) {
    throw new Error(
      `Renovate is not installed under ${PREFIX_ENV}=${prefix}. Run \`node scripts/install-renovate.ts\` (or \`bun run check:renovate-config\`, which does) first.`,
    )
  }
  if (installed !== version) {
    throw new Error(
      `Renovate under ${prefix} is ${installed} but ${WORKFLOW_FILE} pins ${version}. Re-run \`node scripts/install-renovate.ts\`.`,
    )
  }
  return packageDirectory(prefix)
}

export interface InstallCommand {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
}

export type RunInstall = (command: InstallCommand) => {status: number | null; error?: Error | undefined}

/**
 * `process.env` without the `npm_package_*` variables a package-script runner (`bun run`) leaks in. Bun keeps
 * an inherited `npm_package_json`, so `bun run install` inside `re2` would otherwise hand re2's
 * `install-from-cache` this repository's manifest, find no GitHub repository to download the prebuilt
 * binary from, and compile from source. Without the leak Bun points it at re2's own `package.json`.
 */
function envWithoutPackageContext(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('npm_package_')))
}

const runInstallCommand: RunInstall = ({command, args, cwd}) =>
  // stdout is reserved for the prefix path; install progress goes to stderr.
  spawnSync(command, [...args], {
    cwd,
    env: envWithoutPackageContext(),
    stdio: ['ignore', process.stderr, process.stderr],
  })

/**
 * Whether the RE2 native binding under `prefix` loads and compiles a pattern, which is the same test
 * Renovate's `util/regex.ts` applies to pick its regex engine.
 */
export function isRe2Available(prefix: string): boolean {
  try {
    const requireFromRenovate = createRequire(join(packageDirectory(prefix), 'package.json'))
    const RE2 = requireFromRenovate('re2') as new (pattern: string) => {exec: (input: string) => unknown}
    new RE2('.*').exec('test')
    return true
  } catch {
    return false
  }
}

function runCommand(run: RunInstall, command: InstallCommand, label: string): void {
  const result = run(command)
  if (result.error !== undefined) throw new Error(`${label} failed to start: ${errorMessage(result.error)}`)
  if (result.status !== 0) throw new Error(`${label} exited ${String(result.status)}`)
}

/** Release-age floor for the scratch install, in seconds (3 days). */
const MINIMUM_RELEASE_AGE_SECONDS = 259_200

/**
 * Installs the pinned Renovate into `prefix` and makes sure its RE2 binding works. The prefix gets its
 * own `package.json` pinning Renovate exactly, `cwd` is the prefix itself and `--no-save` keeps Bun
 * from writing a lockfile, so the repo's `package.json` and `bun.lock` are never touched.
 * `--minimum-release-age` refuses any package version published less than 3 days ago, transitive
 * dependencies included.
 *
 * `--ignore-scripts` keeps lifecycle scripts off for every package, which leaves `re2` without its
 * native binding; Renovate then validates regexes with JavaScript `RegExp` (lookahead and
 * backreferences pass) while downstream runs use RE2 and reject them. So the one `install` script of
 * `re2` (download the prebuilt binary, else compile) is run directly with `bun run`, which is not
 * gated by `--ignore-scripts`. No other package's script runs.
 */
export async function installRenovate(
  prefix: string,
  version: string,
  run: RunInstall = runInstallCommand,
  re2Available: (prefix: string) => boolean = isRe2Available,
): Promise<'already-installed' | 'installed'> {
  const alreadyInstalled = (await readInstalledVersion(prefix)) === version

  if (!alreadyInstalled) {
    await mkdir(prefix, {recursive: true})
    await writeFile(
      join(prefix, 'package.json'),
      `${JSON.stringify({name: 'renovate-runtime', private: true, dependencies: {renovate: version}}, null, 2)}\n`,
    )
    runCommand(
      run,
      {
        command: 'bun',
        args: ['install', `--minimum-release-age=${MINIMUM_RELEASE_AGE_SECONDS}`, '--ignore-scripts', '--no-save'],
        cwd: prefix,
      },
      `bun install renovate@${version}`,
    )
    // The explicit post-condition: bun exiting 0 is not proof the pinned version landed.
    await assertRenovateInstalled(prefix, version)
  }

  if (!re2Available(prefix)) {
    runCommand(
      run,
      {
        command: 'bun',
        args: ['run', 'install'],
        cwd: join(prefix, 'node_modules', 're2'),
      },
      'bun run install (re2)',
    )
    assertRe2Available(prefix, re2Available)
  }

  return alreadyInstalled ? 'already-installed' : 'installed'
}

const RE2_REMEDY = 'Re-run `node scripts/install-renovate.ts` on a host that can download or compile re2.'

function assertRe2Available(prefix: string, re2Available: (prefix: string) => boolean): void {
  if (!re2Available(prefix)) throw new Error(`RE2 is still not usable under ${prefix} after building it. ${RE2_REMEDY}`)
}

export interface RenovateRuntime {
  readonly version: string
  /** Absolute path of `renovate-config-validator`'s entry module. */
  readonly validatorPath: string
  /** Renovate's own JSON5 parser, so config text parses exactly as Renovate would read it. */
  readonly parseConfig: (text: string) => unknown
  readonly versioning: VersioningEngine
}

type AnyFunction = (...args: unknown[]) => unknown

function pickFunction(source: unknown, name: string, origin: string): AnyFunction {
  const candidate = isRecord(source) ? source[name] : undefined
  if (typeof candidate !== 'function') throw new TypeError(`${origin} does not export a function named ${name}`)
  return candidate as AnyFunction
}

/** Throws unless Renovate's `util/regex.ts` selected RE2, which is what every downstream run uses. */
export function assertRegexEngineIsRe2(regexModule: unknown, prefix: string): void {
  const status = isRecord(regexModule) ? regexModule.regexEngineStatus : undefined
  const type = isRecord(status) ? status.type : undefined
  if (type === 'available') return
  const [reason = ''] = type === 'unavailable' && isRecord(status) ? errorMessage(status.err).split('\n') : []
  const detail = reason === '' ? '' : `: ${reason}`
  throw new Error(
    `Renovate under ${prefix} is not using the RE2 regex engine (status ${JSON.stringify(type)}${detail}). Regex validation would use JavaScript RegExp and accept patterns RE2 rejects. ${RE2_REMEDY}`,
  )
}

/**
 * Loads Renovate's versioning API, regex predicate, semver and JSON5 parser from the prefix, and
 * fails unless Renovate's regex engine is RE2. The package has no `exports` map, so `dist/` paths
 * resolve directly; these are internals, which is why the pin is exact and the integration test
 * exercises them against the real install.
 */
export async function loadRenovateRuntime(prefix: string, version: string): Promise<RenovateRuntime> {
  const packageDir = await assertRenovateInstalled(prefix, version)
  const requireFromRenovate = createRequire(join(packageDir, 'package.json'))

  const versioningModule: unknown = await import(
    pathToFileURL(join(packageDir, 'dist/modules/versioning/index.js')).href
  )
  const stringMatchModule: unknown = await import(pathToFileURL(join(packageDir, 'dist/util/string-match.js')).href)
  const regexModule: unknown = await import(pathToFileURL(join(packageDir, 'dist/util/regex.js')).href)
  assertRegexEngineIsRe2(regexModule, prefix)

  const getVersioningList = pickFunction(versioningModule, 'getVersioningList', 'renovate versioning module')
  const get = pickFunction(versioningModule, 'get', 'renovate versioning module')
  const getRegexPredicate = pickFunction(stringMatchModule, 'getRegexPredicate', 'renovate string-match module')
  const json5: unknown = requireFromRenovate('json5')
  const parseJson5 = pickFunction(json5, 'parse', 'json5')
  // The same `semver` Renovate's lookup filter imports, resolved from the same install.
  const semver: unknown = requireFromRenovate('semver')
  const semverValidRange = pickFunction(semver, 'validRange', 'semver')

  const versioning: VersioningEngine = {
    isKnownVersioning: spec => {
      const names: unknown = getVersioningList()
      const [name = ''] = spec.split(':')
      return Array.isArray(names) && names.includes(name)
    },
    hasRegexPredicate: value => getRegexPredicate(value) !== null,
    isValidSemverRange: value => Reflect.apply(semverValidRange, semver, [value]) !== null,
    isValid: (spec, value) => {
      const api: unknown = get(spec)
      const isValid = pickFunction(api, 'isValid', `renovate versioning ${spec}`)
      // Called as a method: class-based versionings (regex, ...) rely on `this`.
      return Reflect.apply(isValid, api, [value]) === true
    },
  }

  return {
    version,
    validatorPath: requireFromRenovate.resolve('./dist/config-validator.js'),
    parseConfig: text => parseJson5(text),
    versioning,
  }
}
