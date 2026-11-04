/**
 * Surface tier for the `@fro-bot/ci-checks` CLIs end to end: each test runs the real `scripts/<name>.ts` entrypoint in a
 * child process, the callers' runtime (Bun, or Node for the three Renovate CLIs), through the goke runner and the production
 * modules. Nothing inside a CLI is mocked, so a broken entrypoint, runner config, exit-code mapping or root resolution fails
 * here. The only fakes are the executables the CLIs call: `bun audit`, `bun install`, `gh` and `bunx stryker`, as scripts
 * ahead of the real ones on `PATH`.
 *
 * The workflows and package scripts read these from the CLIs:
 * - `main.yaml`: the exit code of `check-mutation-guards` (0 for clean and not-applicable, 1 otherwise) and, from the step
 *   summary, its located list and verdict.
 * - `package.json`: the `lint` chain (`check:md-links && check:override-floors && check:solutions-examples && eslint`) and the
 *   `check:renovate-config` chain (`install-renovate && check-renovate-config`), each stopping at the first non-zero exit.
 * - `fro-bot.yaml`: the agent prompt acts on the exit code of `bun scripts/check-override-floors.ts`.
 *
 * The mutation gate resolves its repository root from where its module lives. Every case that would reach a Stryker spawn, and
 * with it the `rmSync` of the report, runs against a copy of the package in a test-owned directory, so the real checkout's
 * `reports/mutation/mutation.json` is never at risk. The cases that run against the real root stop before the spawn
 * (not-applicable, or a failed changed-file fetch). The last test checks the real checkout is untouched, with a positive control.
 */

import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import {tmpdir} from 'node:os'
import {delimiter, dirname, join, relative, resolve} from 'node:path'
import process from 'node:process'
import {spawnEntrypoint, type SpawnEntrypointResult} from '@fro-bot/test-kit/spawn-entrypoint'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const repoRoot = resolve(import.meta.dirname, '..')

let root = ''
let binDir = ''
const realBun = findOnPath('bun')

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ci-checks-flows-'))
  binDir = join(root, 'bin')
  mkdirSync(binDir)
  fakeExecutable(
    'bun',
    `const {spawnSync} = require('node:child_process')
const argv = process.argv.slice(2)
if (argv[0] === 'audit') {
  process.stdout.write(process.env.FAKE_AUDIT_JSON ?? '')
  process.exit(Number(process.env.FAKE_AUDIT_EXIT ?? 0))
}
if (argv[0] === 'install') process.exit(Number(process.env.FAKE_INSTALL_EXIT ?? 0))
const run = spawnSync(process.env.REAL_BUN, argv, {stdio: 'inherit'})
process.exit(run.status ?? 1)
`,
  )
  fakeExecutable(
    'gh',
    String.raw`const {appendFileSync} = require('node:fs')
if (process.env.FAKE_GH_LOG) appendFileSync(process.env.FAKE_GH_LOG, process.argv.slice(2).join(' ') + '\n')
if (process.env.FAKE_GH_FILES === undefined) {
  process.stderr.write('gh: files unavailable (fake)\n')
  process.exit(1)
}
process.stdout.write(process.env.FAKE_GH_FILES)
`,
  )
  fakeExecutable(
    'bunx',
    String.raw`const {appendFileSync} = require('node:fs')
const scrubbed = ['GITHUB_STEP_SUMMARY', 'GH_TOKEN', 'GITHUB_TOKEN'].map(name => name + '=' + (process.env[name] ?? '<unset>'))
appendFileSync(process.env.FAKE_BUNX_LOG, JSON.stringify({argv: process.argv.slice(2), cwd: process.cwd(), scrubbed}) + '\n')
process.exit(Number(process.env.FAKE_BUNX_EXIT ?? 1))
`,
  )
})

afterAll(() => {
  rmSync(root, {recursive: true, force: true})
})

/** The first executable called `name` on the parent's PATH, as an absolute path. */
function findOnPath(name: string): string {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(directory, name)
    if (existsSync(candidate)) return candidate
  }
  throw new Error(`${name} is not on PATH`)
}

/** A Node script with a shebang in the fake bin directory, so it runs without a shell. */
function fakeExecutable(name: string, body: string): void {
  const path = join(binDir, name)
  writeFileSync(path, `#!/usr/bin/env node\n${body}`)
  chmodSync(path, 0o755)
}

let checkoutCount = 0
/** A test-owned directory holding `files`, used as the working directory and the target of every write. */
function checkout(files: Readonly<Record<string, string>> = {}): string {
  checkoutCount += 1
  const directory = join(root, `cwd-${String(checkoutCount)}`)
  mkdirSync(directory, {recursive: true})
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), {recursive: true})
    writeFileSync(join(directory, path), content)
  }
  return directory
}

interface RunOptions {
  readonly argv?: readonly string[]
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string | undefined>>
}

/** The child's PATH puts the fake executables ahead of the real ones. */
function childEnv(extra: Readonly<Record<string, string | undefined>> = {}): Record<string, string | undefined> {
  return {PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`, REAL_BUN: realBun, ...extra}
}

async function run(script: string, runtime: 'bun' | 'node', options: RunOptions = {}): Promise<SpawnEntrypointResult> {
  return spawnEntrypoint({
    entrypoint: resolve(repoRoot, 'scripts', `${script}.ts`),
    runtime,
    ...(runtime === 'bun' ? {executable: realBun, runtimeArgs: ['--no-install', '--no-env-file']} : {}),
    argv: options.argv,
    cwd: options.cwd ?? checkout(),
    env: childEnv(options.env),
  })
}

/** Runs `script` under `bash <flags> -c`; `$1` is the entrypoint, `$2` the real bun and the rest are `argv`. */
async function shell(
  flags: readonly string[],
  script: string,
  entrypoint: string,
  options: RunOptions = {},
): Promise<SpawnEntrypointResult> {
  return spawnEntrypoint({
    entrypoint: script,
    argv: ['_', resolve(repoRoot, 'scripts', `${entrypoint}.ts`), realBun, ...(options.argv ?? [])],
    executable: 'bash',
    runtimeArgs: [...flags, '-c'],
    cwd: options.cwd ?? checkout(),
    env: childEnv(options.env),
  })
}

const PIPEFAIL = ['-Eeuo', 'pipefail']

/** A map of every file under `paths` (relative to `base`) to its digest. A missing path contributes nothing. */
function snapshotTree(base: string, paths: readonly string[]): Map<string, string> {
  const files = new Map<string, string>()
  const visit = (absolute: string): void => {
    if (!existsSync(absolute)) return
    if (statSync(absolute).isFile()) {
      files.set(relative(base, absolute), createHash('sha256').update(readFileSync(absolute)).digest('hex'))
      return
    }
    for (const entry of readdirSync(absolute, {withFileTypes: true})) {
      const child = join(absolute, entry.name)
      if (entry.isDirectory()) visit(child)
      else if (entry.isFile())
        files.set(relative(base, child), createHash('sha256').update(readFileSync(child)).digest('hex'))
    }
  }
  for (const path of paths) visit(join(base, path))
  return files
}

/** The real checkout, listed before any test runs: the final test compares it with the tree after every flow. */
const realCheckoutBefore = snapshotTree(repoRoot, [
  'reports',
  'packages/ci-checks',
  'stryker.config.json',
  'mutation-guards.json',
])

const USAGE_ARGV: readonly (readonly string[])[] = [['--help'], ['--help=false'], ['-h'], ['--bogus'], ['stray']]

// ---------------------------------------------------------------------------------------------------------------------
// check-md-links
// ---------------------------------------------------------------------------------------------------------------------

describe('scripts/check-md-links.ts', () => {
  const good = {'README.md': '[Docs](docs/guide.md)\n', 'docs/guide.md': '[Root](../README.md)\n'}
  const broken = {
    'README.md': '[Docs](docs/guide.md)\n',
    'docs/guide.md': '[One](missing-one.md)\n\n[Two](missing-two.md)\n',
  }

  it('exits 0 with no output on a tree whose links resolve', async () => {
    const result = await run('check-md-links', 'bun', {cwd: checkout(good)})
    expect(result).toMatchObject({exitCode: 0, stdout: '', stderr: ''})
  })

  it('exits 1 with one path:line -> target line per broken link on stderr', async () => {
    const result = await run('check-md-links', 'bun', {cwd: checkout(broken)})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('docs/guide.md:1 -> missing-one.md\ndocs/guide.md:3 -> missing-two.md\n')
  })

  it('fails a `bash -Eeuo pipefail` pipeline through `| tee`, and the tee file holds the lines', async () => {
    const cwd = checkout(broken)
    const result = await shell(PIPEFAIL, '"$2" "$1" 2>&1 | tee out.txt; echo unreachable', 'check-md-links', {cwd})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('docs/guide.md:1 -> missing-one.md\ndocs/guide.md:3 -> missing-two.md\n')
    expect(result.stdout).not.toContain('unreachable')
    expect(readFileSync(join(cwd, 'out.txt'), 'utf8')).toBe(result.stdout)
  })

  it.each(USAGE_ARGV)('%j is a usage error that checks nothing', async (...argv) => {
    const result = await run('check-md-links', 'bun', {argv, cwd: checkout(broken)})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Usage')
    expect(result.stderr).not.toContain('missing-one.md')
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// check-override-floors
// ---------------------------------------------------------------------------------------------------------------------

describe('scripts/check-override-floors.ts', () => {
  const advisory = (severity: string) =>
    JSON.stringify({'left-pad': [{id: 1, severity, vulnerable_versions: '<1.2.3', url: 'https://example.invalid/1'}]})

  // The agent prompt in fro-bot.yaml acts on exit 0; the lint chain stops on anything else. `bun audit` exits non-zero
  // whenever any advisory exists, so the audit's own exit code is deliberately set to 1 for every advisory case.
  it.each([
    ['a clean audit', '{}', 0, 0],
    ['a clean audit with a failing audit exit code', '{}', 1, 0],
    [
      'moderate and low advisories',
      JSON.stringify({
        a: [
          {id: 1, severity: 'moderate', vulnerable_versions: '<1'},
          {id: 2, severity: 'low', vulnerable_versions: '<1'},
        ],
      }),
      1,
      0,
    ],
    ['a high advisory', advisory('high'), 1, 1],
    ['a critical advisory', advisory('critical'), 1, 1],
    ['output that is not JSON', 'this is not json', 1, 1],
    ['empty output', '', 0, 1],
    ['a package map whose entry is not an array', '{"a": {"id": 1}}', 1, 1],
    ['an advisory with an unrecognized severity', advisory('catastrophic'), 1, 1],
  ])('for %s the entrypoint exits %#d as the prompt reads it', async (_name, audit, auditExit, expected) => {
    const result = await run('check-override-floors', 'bun', {
      env: {FAKE_AUDIT_JSON: audit, FAKE_AUDIT_EXIT: String(auditExit)},
    })
    expect(result.exitCode).toBe(expected)
    expect(result.stdout).toBe('')
    if (expected === 0) expect(result.stderr).toBe('')
    else expect(result.stderr).toMatch(/^check-override-floors: /u)
  })

  it('names a high advisory with its package, id, severity, range and advisory URL', async () => {
    const result = await run('check-override-floors', 'bun', {
      env: {FAKE_AUDIT_JSON: advisory('high'), FAKE_AUDIT_EXIT: '1'},
    })
    expect(result.stderr).toBe(
      'check-override-floors: left-pad: advisory 1 (HIGH) affects an installed version in vulnerable range "<1.2.3"; advisory: https://example.invalid/1\n',
    )
  })

  it('reports the exit code the agent prompt reads, as a shell step sees it', async () => {
    const result = await shell(['+e'], '"$2" "$1"; echo "prompt-exit=$?"', 'check-override-floors', {
      env: {FAKE_AUDIT_JSON: advisory('critical'), FAKE_AUDIT_EXIT: '1'},
    })
    expect(result.stdout).toBe('prompt-exit=1\n')
  })

  it.each(USAGE_ARGV)('%j is a usage error that runs no audit', async (...argv) => {
    const result = await run('check-override-floors', 'bun', {argv, env: {FAKE_AUDIT_JSON: '{}', FAKE_AUDIT_EXIT: '0'}})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Usage')
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// check-solutions-examples
// ---------------------------------------------------------------------------------------------------------------------

describe('scripts/check-solutions-examples.ts', () => {
  const lib = 'export function add(a: number, b: number): number {\n  return a + b\n}\n'
  const doc = (body: string) => ({'docs/solutions/x/doc.md': `# Doc\n\n${body}\n`, 'src/lib.ts': lib})

  it('exits 0 with no output when every example parses and the verify marker holds', async () => {
    const files = doc('<!-- verify: add from src/lib.ts -->\n```ts\nconst total = add(1, 2)\n```')
    expect(await run('check-solutions-examples', 'bun', {cwd: checkout(files)})).toMatchObject({
      exitCode: 0,
      stdout: '',
      stderr: '',
    })
  })

  it('exits 1 on a verify marker whose call has the wrong arity', async () => {
    const files = doc('<!-- verify: add from src/lib.ts -->\n```ts\nconst total = add(1)\n```')
    const result = await run('check-solutions-examples', 'bun', {cwd: checkout(files)})
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/^docs\/solutions\/x\/doc\.md:5 -> \[add in src\/lib\.ts\] /u)
  })

  it('exits 1 on a block that does not parse', async () => {
    const result = await run('check-solutions-examples', 'bun', {cwd: checkout(doc('```ts\nconst = ;\n```'))})
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/^docs\/solutions\/x\/doc\.md:4 -> /u)
  })

  it('exits 1 on a mistyped verify keyword rather than skipping the marker', async () => {
    const result = await run('check-solutions-examples', 'bun', {
      cwd: checkout(doc('<!-- verifies: add from src/lib.ts -->\n```ts\nadd(1, 2)\n```')),
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/^docs\/solutions\/x\/doc\.md:3 -> /u)
  })

  it('does not follow a verify path out of the checkout', async () => {
    const outside = join(root, 'outside.ts')
    writeFileSync(outside, lib)
    const result = await run('check-solutions-examples', 'bun', {
      cwd: checkout(doc(`<!-- verify: add from ../outside.ts -->\n\`\`\`ts\nadd(1, 2)\n\`\`\``)),
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).not.toBe('')
  })

  it.each(USAGE_ARGV)('%j is a usage error that checks nothing', async (...argv) => {
    const result = await run('check-solutions-examples', 'bun', {argv, cwd: checkout(doc('```ts\nconst = ;\n```'))})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Usage')
    expect(result.stderr).not.toContain('doc.md')
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// The `bun run lint` chain, from the real package.json
// ---------------------------------------------------------------------------------------------------------------------

describe('the package.json lint chain', () => {
  const scripts = (
    JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {scripts: Record<string, string>}
  ).scripts

  /** A package.json whose scripts are the real ones with `scripts/` made absolute; `eslint`, the last link, is a marker. */
  function chainCheckout(files: Readonly<Record<string, string>>): string {
    const cwd = checkout(files)
    const rewrite = (text: string): string => text.replaceAll('scripts/', `${join(repoRoot, 'scripts')}/`)
    const manifest = {
      scripts: Object.fromEntries(
        ['check:md-links', 'check:override-floors', 'check:solutions-examples', 'lint'].map(name => [
          name,
          rewrite(scripts[name] ?? '').replace(/&& eslint$/u, '&& echo reached-eslint'),
        ]),
      ),
    }
    writeFileSync(join(cwd, 'package.json'), JSON.stringify(manifest))
    return cwd
  }

  async function runLint(cwd: string, env: Record<string, string>): Promise<SpawnEntrypointResult> {
    return spawnEntrypoint({
      entrypoint: 'run',
      argv: ['lint'],
      executable: realBun,
      runtimeArgs: ['--no-install', '--no-env-file'],
      cwd,
      env: childEnv(env),
    })
  }

  const goodTree = {'README.md': '[Docs](docs/guide.md)\n', 'docs/guide.md': '[Root](../README.md)\n'}

  it('is the chain the plan names: md-links, override-floors, solutions-examples, eslint, joined by &&', () => {
    expect(scripts.lint).toBe(
      'bun run check:md-links && bun run check:override-floors && bun run check:solutions-examples && eslint',
    )
    expect(scripts['check:md-links']).toBe('bun scripts/check-md-links.ts')
    expect(scripts['check:override-floors']).toBe('bun scripts/check-override-floors.ts')
    expect(scripts['check:solutions-examples']).toBe('bun scripts/check-solutions-examples.ts')
    expect(scripts['check:renovate-config']).toBe(
      'node scripts/install-renovate.ts && node scripts/check-renovate-config.ts',
    )
    expect(scripts['check:mutation-guards']).toBe('bun scripts/check-mutation-guards.ts')
  })

  it('reaches the last link when every check passes', async () => {
    const result = await runLint(chainCheckout(goodTree), {FAKE_AUDIT_JSON: '{}', FAKE_AUDIT_EXIT: '0'})
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('reached-eslint')
  })

  it('stops at a broken link: the later checks never run', async () => {
    const cwd = chainCheckout({'README.md': '[x](nowhere.md)\n'})
    const result = await runLint(cwd, {
      FAKE_AUDIT_JSON: '{"a": [{"id": 1, "severity": "high", "vulnerable_versions": "<1"}]}',
      FAKE_AUDIT_EXIT: '1',
    })
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('README.md:1 -> nowhere.md')
    expect(result.stderr).not.toContain('check-override-floors:')
    expect(result.stdout).not.toContain('reached-eslint')
  })

  it('stops at a high advisory: the examples check and the last link never run', async () => {
    const result = await runLint(chainCheckout({...goodTree, 'docs/solutions/x/doc.md': '```ts\nconst = ;\n```\n'}), {
      FAKE_AUDIT_JSON: '{"a": [{"id": 1, "severity": "high", "vulnerable_versions": "<1"}]}',
      FAKE_AUDIT_EXIT: '1',
    })
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('check-override-floors: a: advisory 1 (HIGH)')
    expect(result.stderr).not.toContain('doc.md')
    expect(result.stdout).not.toContain('reached-eslint')
  })

  it('stops at a broken example before the last link', async () => {
    const result = await runLint(chainCheckout({...goodTree, 'docs/solutions/x/doc.md': '```ts\nconst = ;\n```\n'}), {
      FAKE_AUDIT_JSON: '{}',
      FAKE_AUDIT_EXIT: '0',
    })
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('docs/solutions/x/doc.md:2 -> ')
    expect(result.stdout).not.toContain('reached-eslint')
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// install-renovate, check-renovate-config, check-renovate-ranges (Node)
// ---------------------------------------------------------------------------------------------------------------------

describe('the Renovate entrypoints under Node', () => {
  const pinned = (version: string) => `name: Main\nenv:\n  RENOVATE_VERSION: ${version}\njobs: {}\n`
  const withPin = (extra: Record<string, string> = {}) => ({
    '.github/workflows/main.yaml': pinned('44.198.0'),
    ...extra,
  })

  it('install-renovate prints install-renovate: <message> and exits 1 when the workflow file is missing', async () => {
    const result = await run('install-renovate', 'node', {
      cwd: checkout(),
      env: {RENOVATE_PREFIX: join(root, 'prefix-a')},
    })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(/^install-renovate: ENOENT: no such file or directory, open '.*main\.yaml'\n$/u)
  })

  it('install-renovate rejects a workflow whose pin is not an exact version', async () => {
    const result = await run('install-renovate', 'node', {
      cwd: checkout({'.github/workflows/main.yaml': pinned('latest')}),
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe(
      'install-renovate: .github/workflows/main.yaml: top-level env.RENOVATE_VERSION must be an exact x.y.z version string, got "latest"\n',
    )
  })

  it('install-renovate reports a failed `bun install` and exits 1 with nothing on stdout', async () => {
    const prefix = join(root, 'prefix-b')
    const result = await run('install-renovate', 'node', {
      cwd: checkout(withPin()),
      env: {RENOVATE_PREFIX: prefix, FAKE_INSTALL_EXIT: '1'},
    })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('install-renovate: bun install renovate@44.198.0 exited 1\n')
    expect(JSON.parse(readFileSync(join(prefix, 'package.json'), 'utf8'))).toEqual({
      name: 'renovate-runtime',
      private: true,
      dependencies: {renovate: '44.198.0'},
    })
  })

  it.each(['check-renovate-config', 'check-renovate-ranges'])(
    '%s says the scratch install is missing, with a plain message, and exits 1',
    async script => {
      const prefix = join(root, 'not-installed')
      const result = await run(script, 'node', {
        cwd: checkout(withPin({'default.json': '{}', '.github/renovate.json5': '{}'})),
        env: {RENOVATE_PREFIX: prefix},
      })
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe(
        `${script}: Renovate is not installed under RENOVATE_PREFIX=${prefix}. Run \`node scripts/install-renovate.ts\` (or \`bun run check:renovate-config\`, which does) first.\n`,
      )
    },
  )

  it.each(['install-renovate', 'check-renovate-config', 'check-renovate-ranges'])(
    '%s: an unmatched argv is a usage error that runs nothing',
    async script => {
      // A bare word is a config path to check-renovate-ranges, which takes any number of them.
      for (const argv of script === 'check-renovate-ranges'
        ? USAGE_ARGV.filter(argv => argv[0] !== 'stray')
        : USAGE_ARGV) {
        const result = await run(script, 'node', {
          argv,
          cwd: checkout(withPin()),
          env: {RENOVATE_PREFIX: join(root, 'prefix-c'), FAKE_INSTALL_EXIT: '1'},
        })
        expect(result.exitCode, argv.join(' ')).toBe(1)
        expect(result.stdout).toBe('')
        expect(result.stderr).toContain('Usage')
        expect(existsSync(join(root, 'prefix-c'))).toBe(false)
      }
    },
  )

  it('the check:renovate-config chain stops at a failed install: the check never runs', async () => {
    const cwd = checkout(withPin({'default.json': '{}', '.github/renovate.json5': '{}'}))
    const rewrite = (text: string): string => text.replaceAll('scripts/', `${join(repoRoot, 'scripts')}/`)
    const chain = rewrite(
      (JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {scripts: Record<string, string>}).scripts[
        'check:renovate-config'
      ] ?? '',
    )
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({scripts: {'check:renovate-config': chain}}))
    const result = await spawnEntrypoint({
      entrypoint: 'run',
      argv: ['check:renovate-config'],
      executable: realBun,
      runtimeArgs: ['--no-install', '--no-env-file'],
      cwd,
      env: childEnv({RENOVATE_PREFIX: join(root, 'prefix-d'), FAKE_INSTALL_EXIT: '1'}),
    })
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('install-renovate: bun install renovate@44.198.0 exited 1')
    expect(result.stderr).not.toContain('check-renovate-config:')
  })

  it('the same chain under bash -Eeuo pipefail with | tee fails the pipeline', async () => {
    const cwd = checkout(withPin())
    const result = await shell(PIPEFAIL, 'node "$1" 2>&1 | tee out.txt; echo unreachable', 'install-renovate', {
      cwd,
      env: {RENOVATE_PREFIX: join(root, 'prefix-e'), FAKE_INSTALL_EXIT: '1'},
    })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('install-renovate: bun install renovate@44.198.0 exited 1\n')
    expect(readFileSync(join(cwd, 'out.txt'), 'utf8')).toBe(result.stdout)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// check-mutation-guards
// ---------------------------------------------------------------------------------------------------------------------

describe('scripts/check-mutation-guards.ts against the real repository root', () => {
  const eventFile = (name: string): string => {
    const path = join(root, `${name}.json`)
    writeFileSync(
      path,
      JSON.stringify({
        pull_request: {
          number: 7,
          user: {login: 'someone'},
          head: {ref: 'feature', repo: {full_name: 'fro-bot/.github'}},
          base: {repo: {full_name: 'fro-bot/.github'}},
        },
      }),
    )
    return path
  }

  it('is not-applicable for a docs-only change: exit 0, the verdict on stdout and in the step summary, no Stryker', async () => {
    const summary = join(root, 'summary-na.md')
    writeFileSync(summary, 'earlier\n')
    const log = join(root, 'bunx-na.log')
    const result = await run('check-mutation-guards', 'bun', {
      env: {
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: eventFile('na'),
        GITHUB_STEP_SUMMARY: summary,
        FAKE_GH_FILES: 'README.md\ndocs/plans/x.md\n',
        FAKE_BUNX_LOG: log,
      },
    })
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toMatch(/^trigger-gate:0:0 trigger-gate NotApplicable\nnot-applicable\n$/u)
    expect(readFileSync(summary, 'utf8')).toBe(`earlier\n${result.stdout}`)
    expect(existsSync(log)).toBe(false)
  })

  it('fails closed with instrumentation-failed and exit 1 when the changed files cannot be fetched', async () => {
    const result = await run('check-mutation-guards', 'bun', {
      env: {
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: eventFile('gh-fails'),
        FAKE_BUNX_LOG: join(root, 'bunx-closed.log'),
      },
    })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toMatch(/^trigger-gate:0:0 trigger-gate ChangedFileGateFailed\ninstrumentation-failed\n$/u)
    expect(result.stderr).toContain('gh: files unavailable (fake)')
    expect(existsSync(join(root, 'bunx-closed.log'))).toBe(false)
  })

  it('fails closed when the pull_request event has no payload path', async () => {
    const result = await run('check-mutation-guards', 'bun', {
      env: {GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: '', FAKE_GH_FILES: 'README.md\n'},
    })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toMatch(/instrumentation-failed\n$/u)
  })

  it.each(USAGE_ARGV)('%j is a usage error: exit 1, no gate, no verdict', async (...argv) => {
    const result = await run('check-mutation-guards', 'bun', {
      argv,
      env: {GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: eventFile('usage'), FAKE_GH_FILES: 'README.md\n'},
    })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Usage')
  })

  it('does nothing when the entrypoint is imported rather than run', () => {
    const log = join(root, 'bunx-import.log')
    const entrypoint = resolve(repoRoot, 'scripts', 'check-mutation-guards.ts')
    const stdout = execFileSync(
      realBun,
      [
        '--no-install',
        '--no-env-file',
        '--eval',
        `await import(${JSON.stringify(entrypoint)}); console.log('imported')`,
      ],
      {
        cwd: checkout(),
        encoding: 'utf8',
        env: {
          ...childEnv({FAKE_BUNX_LOG: log, GITHUB_EVENT_NAME: undefined}),
          HOME: process.env.HOME,
        },
      },
    )
    // Nothing ran: no verdict was printed and nothing was spawned.
    expect(stdout).toBe('imported\n')
    expect(existsSync(log)).toBe(false)
  })
})

/**
 * A test-owned copy of the gate: the entrypoint, `packages/ci-checks` (its non-test source) and a `stryker.config.json`. Its
 * `node_modules/@fro-bot/ci-checks` links to the copy and `@fro-bot/core` to the real package, so the entrypoint resolves the
 * gate by name to the copy and the gate's root is the copy.
 */
function copyOfTheGate(config: string | undefined, extra: Readonly<Record<string, string>> = {}): string {
  const copy = checkout(extra)
  mkdirSync(join(copy, 'scripts'))
  cpSync(join(repoRoot, 'scripts', 'check-mutation-guards.ts'), join(copy, 'scripts', 'check-mutation-guards.ts'))
  cpSync(join(repoRoot, 'packages', 'ci-checks'), join(copy, 'packages', 'ci-checks'), {
    recursive: true,
    filter: source => !source.endsWith('.test.ts'),
  })
  mkdirSync(join(copy, 'node_modules', '@fro-bot'), {recursive: true})
  symlinkSync(join(copy, 'packages', 'ci-checks'), join(copy, 'node_modules', '@fro-bot', 'ci-checks'))
  symlinkSync(join(repoRoot, 'packages', 'core'), join(copy, 'node_modules', '@fro-bot', 'core'))
  if (config !== undefined) writeFileSync(join(copy, 'stryker.config.json'), config)
  return copy
}

async function runCopy(
  copy: string,
  env: Record<string, string>,
  argv: readonly string[] = [],
): Promise<SpawnEntrypointResult> {
  return spawnEntrypoint({
    entrypoint: join(copy, 'scripts', 'check-mutation-guards.ts'),
    executable: realBun,
    runtimeArgs: ['--no-install', '--no-env-file'],
    argv,
    cwd: checkout(),
    env: childEnv(env),
  })
}

describe('scripts/check-mutation-guards.ts run from a copy of the package: the root is where the module lives', () => {
  const CONFIG = JSON.stringify({
    mutate: ['mutated.ts'],
    testFiles: ['mutated.test.ts'],
    reporters: ['json'],
    jsonReporter: {fileName: 'reports/mutation/mutation.json'},
  })

  const prEnv = (name: string, files: string): Record<string, string> => ({
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_EVENT_PATH: (() => {
      const path = join(root, `${name}.json`)
      writeFileSync(
        path,
        JSON.stringify({
          pull_request: {number: 3, user: {login: 'u'}, head: {ref: 'r'}, base: {repo: {full_name: 'o/r'}}},
        }),
      )
      return path
    })(),
    FAKE_GH_FILES: files,
    GH_TOKEN: 'secret-gh',
    GITHUB_TOKEN: 'secret-github',
  })

  it('fails closed with the copy path in the message when stryker.config.json is missing', async () => {
    const copy = copyOfTheGate(undefined)
    const result = await runCopy(copy, prEnv('missing-config', 'README.md\n'))
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain(
      `ENOENT: no such file or directory, open '${join(realpathOf(copy), 'stryker.config.json')}'`,
    )
    // The wrong answer, one level short, would name the package directory instead.
    expect(result.stderr).not.toContain(join('packages', 'ci-checks', 'stryker.config.json'))
  })

  it('fails closed on a stryker.config.json that is not JSON', async () => {
    const result = await runCopy(copyOfTheGate('{ nope'), prEnv('bad-config', 'README.md\n'))
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).not.toBe('')
  })

  it("classifies by the copy's own trigger set: a docs-only change is not-applicable, no Stryker", async () => {
    const copy = copyOfTheGate(CONFIG)
    const log = join(root, 'bunx-copy-na.log')
    const result = await runCopy(copy, {...prEnv('copy-na', 'README.md\n'), FAKE_BUNX_LOG: log})
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(/^trigger-gate:0:0 trigger-gate NotApplicable\nnot-applicable\n$/u)
    expect(existsSync(log)).toBe(false)
  })

  it.each([
    ['a mutate entry of the copy', 'mutated.ts\n'],
    ['the copy config', 'stryker.config.json\n'],
    ['the entrypoint', 'scripts/check-mutation-guards.ts\n'],
    ['the gate module', 'packages/ci-checks/src/check-mutation-guards.ts\n'],
    ['the CLI wiring', 'packages/ci-checks/src/check-mutation-guards-cli.ts\n'],
    ['the root helper', 'packages/ci-checks/src/repository-root.ts\n'],
    ['a package manifest', 'packages/ci-checks/package.json\n'],
  ])(
    'is applicable for %s: Stryker is spawned from the copy root with the copy config, and the report is read from the copy',
    async (_name, files) => {
      const copy = copyOfTheGate(CONFIG, {'mutated.ts': 'export const a = 1\n'})
      const log = join(root, `bunx-${String(checkoutCount)}.log`)
      const summary = join(root, `summary-${String(checkoutCount)}.md`)
      const result = await runCopy(copy, {
        ...prEnv(`copy-${String(checkoutCount)}`, files),
        FAKE_BUNX_LOG: log,
        FAKE_BUNX_EXIT: '1',
        GITHUB_STEP_SUMMARY: summary,
      })
      // The fake Stryker dies without a report: the verdict is instrumentation-failed, read from the copy's report path.
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain(
        `${join(realpathOf(copy), 'reports', 'mutation', 'mutation.json')}:0:0 ReportUnreadable RuntimeError`,
      )
      expect(result.stdout).toMatch(/instrumentation-failed\n$/u)
      expect(readFileSync(summary, 'utf8')).toBe(result.stdout)

      const calls = readFileSync(log, 'utf8')
        .trimEnd()
        .split('\n')
        .map(line => JSON.parse(line) as {argv: string[]; cwd: string; scrubbed: string[]})
      expect(calls).toHaveLength(1)
      expect(calls[0]?.argv).toEqual(['--no-install', 'stryker', 'run', join(realpathOf(copy), 'stryker.config.json')])
      expect(realpathOf(calls[0]?.cwd ?? '')).toBe(realpathOf(copy))
      // The three variables the gate scrubs before the spawn are absent from the child.
      expect(calls[0]?.scrubbed).toEqual(['GITHUB_STEP_SUMMARY=<unset>', 'GH_TOKEN=<unset>', 'GITHUB_TOKEN=<unset>'])
    },
  )

  it('deletes only the copy report before the spawn, and leaves the real checkout alone', async () => {
    const copy = copyOfTheGate(CONFIG, {
      'mutated.ts': 'export const a = 1\n',
      'reports/mutation/mutation.json': '{"stale": true}',
    })
    const result = await runCopy(copy, {
      ...prEnv('stale', 'mutated.ts\n'),
      FAKE_BUNX_LOG: join(root, 'bunx-stale.log'),
      FAKE_BUNX_EXIT: '1',
    })
    expect(result.exitCode).toBe(1)
    expect(existsSync(join(copy, 'reports', 'mutation', 'mutation.json'))).toBe(false)
    expect(result.stdout).toContain('ReportUnreadable')
    expect(result.stdout).not.toContain('stale')
  })

  it.each(USAGE_ARGV)('%j is a usage error from the copy as well', async (...argv) => {
    const result = await runCopy(copyOfTheGate(CONFIG), prEnv('copy-usage', 'mutated.ts\n'), argv)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Usage')
  })
})

/** The real path of `path`, because the OS temp directory can be a symlink (macOS) and Bun reports the resolved one. */
function realpathOf(path: string): string {
  return realpathSync(path)
}

// ---------------------------------------------------------------------------------------------------------------------

describe('the real checkout', () => {
  it('is untouched by every flow above', () => {
    const after = snapshotTree(repoRoot, [
      'reports',
      'packages/ci-checks',
      'stryker.config.json',
      'mutation-guards.json',
    ])
    expect([...after]).toEqual([...realCheckoutBefore])
  })

  it('would notice a write: a positive control on a test-owned tree', () => {
    const directory = checkout({'reports/mutation/mutation.json': '{}'})
    const before = snapshotTree(directory, ['reports'])
    writeFileSync(join(directory, 'reports', 'mutation', 'mutation.json'), '{"changed": true}')
    expect([...snapshotTree(directory, ['reports'])]).not.toEqual([...before])
    writeFileSync(join(directory, 'reports', 'extra.json'), '{}')
    expect(snapshotTree(directory, ['reports']).has(join('reports', 'extra.json'))).toBe(true)
  })
})
