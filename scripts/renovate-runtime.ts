import type {VersioningEngine} from './check-renovate-ranges.ts'

import {spawnSync} from 'node:child_process'
import {mkdir, readFile} from 'node:fs/promises'
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
 * advisories with no published fix (`braces`, `sprintf-js`) into `pnpm audit`, which `pnpm lint`
 * (`check:override-floors`) fails on. Instead one exact version is installed into a scratch
 * prefix outside the repo at check time (`npm install --prefix`, no lockfile written) and every
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
      `Renovate is not installed under ${PREFIX_ENV}=${prefix}. Run \`node scripts/install-renovate.ts\` (or \`pnpm check:renovate-config\`, which does) first.`,
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

const runInstallCommand: RunInstall = ({command, args, cwd}) =>
  // stdout is reserved for the prefix path; npm progress goes to stderr.
  spawnSync(command, [...args], {cwd, stdio: ['ignore', process.stderr, process.stderr]})

/**
 * Installs the pinned Renovate into `prefix` unless it is already there. `cwd` is the prefix itself
 * and `--no-save --no-package-lock` keeps npm from writing a manifest or lockfile anywhere, so the
 * repo's `package.json` and `pnpm-lock.yaml` are never touched. `--ignore-scripts` skips native
 * build steps (`re2` falls back to RegExp, which the validator logs once).
 */
export async function installRenovate(
  prefix: string,
  version: string,
  run: RunInstall = runInstallCommand,
): Promise<'already-installed' | 'installed'> {
  if ((await readInstalledVersion(prefix)) === version) return 'already-installed'

  await mkdir(prefix, {recursive: true})
  const result = run({
    command: 'npm',
    args: [
      'install',
      '--prefix',
      prefix,
      '--no-save',
      '--no-package-lock',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      `renovate@${version}`,
    ],
    cwd: prefix,
  })
  if (result.error !== undefined) throw new Error(`npm install failed to start: ${errorMessage(result.error)}`)
  if (result.status !== 0) throw new Error(`npm install renovate@${version} exited ${String(result.status)}`)

  // The explicit post-condition: npm exiting 0 is not proof the pinned version landed.
  await assertRenovateInstalled(prefix, version)
  return 'installed'
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

/**
 * Loads Renovate's versioning API, regex predicate and JSON5 parser from the prefix. The package has
 * no `exports` map, so `dist/` paths resolve directly; these are internals, which is why the pin is
 * exact and the integration test exercises them against the real install.
 */
export async function loadRenovateRuntime(prefix: string, version: string): Promise<RenovateRuntime> {
  const packageDir = await assertRenovateInstalled(prefix, version)
  const requireFromRenovate = createRequire(join(packageDir, 'package.json'))

  const versioningModule: unknown = await import(
    pathToFileURL(join(packageDir, 'dist/modules/versioning/index.js')).href
  )
  const stringMatchModule: unknown = await import(pathToFileURL(join(packageDir, 'dist/util/string-match.js')).href)

  const getVersioningList = pickFunction(versioningModule, 'getVersioningList', 'renovate versioning module')
  const get = pickFunction(versioningModule, 'get', 'renovate versioning module')
  const getRegexPredicate = pickFunction(stringMatchModule, 'getRegexPredicate', 'renovate string-match module')
  const json5: unknown = requireFromRenovate('json5')
  const parseJson5 = pickFunction(json5, 'parse', 'json5')

  const versioning: VersioningEngine = {
    isKnownVersioning: spec => {
      const names: unknown = getVersioningList()
      const [name = ''] = spec.split(':')
      return Array.isArray(names) && names.includes(name)
    },
    hasRegexPredicate: value => getRegexPredicate(value) !== null,
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
