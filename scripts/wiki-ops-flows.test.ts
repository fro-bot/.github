/**
 * Surface tier for the wiki-ops CLIs end to end: each test runs the real `scripts/<name>.ts` shim in a
 * child process under Bun, the callers' runtime, through the goke runner (or the hand-written parser)
 * and the production module with its default dependencies. Nothing is mocked inside the CLI, so a broken
 * shim, runner config, env wiring or output path fails here.
 *
 * The workflows read `changed=`, `hash=`, `excerpt`, `selected-paths`, `byte-length` and the five lint
 * counters from `$GITHUB_OUTPUT`, the handoff artifact bytes between build and apply, the repair result
 * file, and the stdout JSON of the handoff steps, the query steps and `wiki-context-expand`. The tests pin
 * each of those, and the usage code of every CLI on the runner.
 */

import {execFileSync} from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {createFakeGithub, route, type FakeGithub, type FakeRoute} from '@fro-bot/test-kit/fake-github'
import {spawnEntrypoint, type SpawnEntrypointResult} from '@fro-bot/test-kit/spawn-entrypoint'
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest'

const repoRoot = resolve(import.meta.dirname, '..')

let root = ''
let fake: FakeGithub | undefined

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'wiki-ops-flows-'))
})

afterAll(() => {
  rmSync(root, {recursive: true, force: true})
})

afterEach(() => {
  fake?.cleanup()
  fake = undefined
})

/** A test-owned directory holding `files`. Every CLI here writes only inside the directory it runs in. */
function checkout(files: Readonly<Record<string, string>>): string {
  const directory = mkdtempSync(join(root, 'cwd-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), {recursive: true})
    writeFileSync(join(directory, path), content)
  }
  return directory
}

function git(cwd: string, ...args: string[]): void {
  execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    {cwd, stdio: 'ignore'},
  )
}

/** A checkout that is a git repository with everything committed. */
function repository(files: Readonly<Record<string, string>>): string {
  const directory = checkout(files)
  git(directory, 'init', '-q', '-b', 'main')
  git(directory, 'add', '-A')
  git(directory, 'commit', '-q', '-m', 'init')
  return directory
}

interface RunOptions {
  readonly argv?: readonly string[]
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly cwd?: string
  readonly githubOutput?: 'file' | 'unset' | 'empty'
  readonly routes?: readonly FakeRoute[]
}

async function run(script: string, options: RunOptions = {}): Promise<SpawnEntrypointResult> {
  const github = options.routes === undefined ? undefined : createFakeGithub(options.routes)
  fake = github ?? fake
  return spawnEntrypoint({
    entrypoint: resolve(repoRoot, 'scripts', `${script}.ts`),
    runtime: 'bun',
    runtimeArgs: github === undefined ? ['--no-install', '--no-env-file'] : github.runtimeArgs('bun'),
    argv: options.argv,
    cwd: options.cwd ?? checkout({}),
    env: {...(github === undefined ? {} : {FAKE_GH_DIR: github.directory}), ...options.env},
    githubOutput: options.githubOutput,
  })
}

/** Reads `$GITHUB_OUTPUT` the way the runner does: `name=value` lines and `name<<DELIM` blocks. */
function parseOutputs(text: string): Record<string, string> {
  const outputs: Record<string, string> = {}
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line === '') continue
    const heredoc = /^([\w-]+)<<(\S+)$/u.exec(line)
    if (heredoc !== null) {
      const block: string[] = []
      index += 1
      while (index < lines.length && lines[index] !== heredoc[2]) {
        block.push(lines[index] ?? '')
        index += 1
      }
      outputs[heredoc[1] ?? ''] = block.join('\n')
      continue
    }
    const equals = line.indexOf('=')
    outputs[line.slice(0, equals)] = line.slice(equals + 1)
  }
  return outputs
}

function unhandledMutations(): string[] {
  return (fake?.unhandledMutations() ?? []).map(request => request.line)
}

function requests(): string[] {
  return (fake?.requests() ?? []).map(request => request.line)
}

const PAGE = (title: string, type: string, body: string, extra = '') =>
  `---\ntype: ${type}\ntitle: ${title}\ncreated: 2026-04-16\nupdated: 2026-04-16\n${extra}---\n\n# ${title}\n\n${body}\n`

const INDEX = `# Wiki Index

Master catalog of all wiki pages, organized by type.

## Repos

- [[acme--widgets]] - acme/widgets

## Topics

- [[polyglot-monorepo]] - Polyglot Monorepo

---
`
const LOG = '# Wiki Log\n\n---\n\n_Entries are appended._\n'

const WIKI = {
  'knowledge/index.md': INDEX,
  'knowledge/log.md': LOG,
  'knowledge/wiki/repos/acme--widgets.md': PAGE(
    'acme/widgets',
    'repo',
    'Widgets has a build system and links [[polyglot-monorepo]].',
    'tags: [build]\nsources:\n  - url: https://github.com/acme/widgets\n    sha: abc123\n    accessed: 2026-04-16\n',
  ),
  'knowledge/wiki/topics/polyglot-monorepo.md': PAGE(
    'Polyglot Monorepo',
    'topic',
    'Monorepo patterns for a shared build.',
    'tags: [monorepo]\n',
  ),
  'metadata/repos.yaml': `version: 1
repos:
  - owner: acme
    name: widgets
    added: 2026-04-17
    onboarding_status: onboarded
    last_survey_at: 2026-10-20
    last_survey_status: success
    has_fro_bot_workflow: false
    has_renovate: true
    next_survey_eligible_at: 2026-11-19
    discovery_channel: collab
    private: false
    node_id: R_kgDOAAAAAA
    database_id: 100
`,
  '.gitignore': 'knowledge/wiki/topics/ignored-*.md\n',
}

/** Argv no caller sends: the runner turns each into a usage error that runs nothing. */
const USAGE_ARGV = [['--help'], ['--help=false'], ['--bogus'], ['stray']] as const

// ─── wiki-change-detect ──────────────────────────────────────────────────────────────────────────

describe('wiki-change-detect (bun; survey-repo.yaml:251 baseline, :360 detect)', () => {
  const HEX = /^[0-9a-f]{64}$/u

  async function baseline(cwd: string): Promise<string> {
    const result = await run('wiki-change-detect', {argv: ['baseline'], cwd})
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('')
    const hash = parseOutputs(result.githubOutput).hash ?? ''
    expect(hash).toMatch(HEX)
    return hash
  }

  it('baseline writes exactly one hash= line', async () => {
    const cwd = repository(WIKI)
    const result = await run('wiki-change-detect', {argv: ['baseline'], cwd})
    expect(result.exitCode).toBe(0)
    expect(result.githubOutput).toMatch(/^hash=[0-9a-f]{64}\n$/u)
    expect(result.stderr).toBe('')
  })

  it('detect writes changed=false for the same content and changed=true after an edit', async () => {
    const cwd = repository(WIKI)
    const hash = await baseline(cwd)
    const same = await run('wiki-change-detect', {argv: ['detect'], cwd, env: {WIKI_CHANGE_BASELINE_HASH: hash}})
    expect(same).toMatchObject({exitCode: 0, githubOutput: 'changed=false\n'})
    writeFileSync(
      join(cwd, 'knowledge/wiki/topics/polyglot-monorepo.md'),
      PAGE('Polyglot Monorepo', 'topic', 'Edited.'),
    )
    const edited = await run('wiki-change-detect', {argv: ['detect'], cwd, env: {WIKI_CHANGE_BASELINE_HASH: hash}})
    expect(edited).toMatchObject({exitCode: 0, githubOutput: 'changed=true\n'})
  })

  it('does not count a git-ignored page, and counts a new untracked one', async () => {
    const cwd = repository(WIKI)
    const hash = await baseline(cwd)
    writeFileSync(join(cwd, 'knowledge/wiki/topics/ignored-x.md'), 'ignored\n')
    const ignored = await run('wiki-change-detect', {argv: ['detect'], cwd, env: {WIKI_CHANGE_BASELINE_HASH: hash}})
    expect(ignored.githubOutput).toBe('changed=false\n')
    writeFileSync(join(cwd, 'knowledge/wiki/topics/brand-new.md'), PAGE('New', 'topic', 'new'))
    const added = await run('wiki-change-detect', {argv: ['detect'], cwd, env: {WIKI_CHANGE_BASELINE_HASH: hash}})
    expect(added.githubOutput).toBe('changed=true\n')
  })

  it.each([['frobnicate'], ['BASELINE'], ['']])(
    'mode %j prints the workflow error naming it and exits 1',
    async mode => {
      const cwd = repository(WIKI)
      const result = await run('wiki-change-detect', {argv: [mode], cwd})
      expect(result).toMatchObject({exitCode: 1, stdout: '', githubOutput: ''})
      expect(result.stderr).toBe(`::error::wiki-change-detect: mode must be "baseline" or "detect" (got ${mode})\n`)
    },
  )

  it('no mode prints (got <none>)', async () => {
    const result = await run('wiki-change-detect', {cwd: repository(WIKI)})
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('::error::wiki-change-detect: mode must be "baseline" or "detect" (got <none>)\n')
  })

  it.each(['unset', 'empty'] as const)('throws when GITHUB_OUTPUT is %s, writing nothing', async githubOutput => {
    const result = await run('wiki-change-detect', {argv: ['baseline'], cwd: repository(WIKI), githubOutput})
    expect(result).toMatchObject({exitCode: 1, stdout: '', githubOutput: ''})
    expect(result.stderr).toBe('::error::wiki-change-detect: GITHUB_OUTPUT is required\n')
  })

  it('refuses a symlink inside the scope and writes no changed= line', async () => {
    const cwd = repository(WIKI)
    const hash = await baseline(cwd)
    symlinkSync('/etc/hosts', join(cwd, 'knowledge/wiki/topics/link.md'))
    const result = await run('wiki-change-detect', {argv: ['detect'], cwd, env: {WIKI_CHANGE_BASELINE_HASH: hash}})
    expect(result).toMatchObject({exitCode: 1, githubOutput: ''})
    expect(result.stderr).toContain('::error::wiki-change-detect: refusing symlink in scope')
  })

  it.each([[['baseline', 'extra']], [['--help']], [['--help=false']], [['--bogus']], [['detect', 'a', 'b']]])(
    'argv %j is a usage error that writes nothing',
    async argv => {
      const result = await run('wiki-change-detect', {
        argv,
        cwd: repository(WIKI),
        env: {WIKI_CHANGE_BASELINE_HASH: 'a'.repeat(64)},
      })
      expect(result).toMatchObject({exitCode: 1, stdout: '', githubOutput: ''})
      expect(result.stderr).not.toContain('::error::wiki-change-detect:')
      expect(result.stderr).not.toBe('')
    },
  )
})

// ─── wiki-handoff-baseline, wiki-handoff-build, wiki-handoff-apply ───────────────────────────────

describe('the handoff chain: baseline, build and apply (survey-repo.yaml:261,513,685; fro-bot.yaml:557,707,762)', () => {
  it('carries the agent delta from the agent checkout to the trusted workspace, byte for byte', async () => {
    const agent = repository(WIKI)
    const workspace = checkout(WIKI)
    const baselinePath = join(root, 'baseline-chain.json')
    const handoff = join(root, 'handoff-chain')

    const base = await run('wiki-handoff-baseline', {cwd: agent, env: {WIKI_HANDOFF_BASELINE_PATH: baselinePath}})
    expect(base).toMatchObject({exitCode: 0, stdout: '{"files":0}\n', stderr: ''})
    expect(JSON.parse(readFileSync(baselinePath, 'utf8'))).toEqual({files: {}, deleted: []})

    const edited = PAGE('Polyglot Monorepo', 'topic', 'Edited by the agent.', 'tags: [monorepo]\n')
    const added = PAGE('New Topic', 'topic', 'Added by the agent.')
    writeFileSync(join(agent, 'knowledge/wiki/topics/polyglot-monorepo.md'), edited)
    writeFileSync(join(agent, 'knowledge/wiki/topics/new-topic.md'), added)
    rmSync(join(agent, 'knowledge/wiki/repos/acme--widgets.md'))
    writeFileSync(join(agent, 'knowledge/log.md'), `${LOG}\n## agent entry\n`)

    const built = await run('wiki-handoff-build', {
      cwd: agent,
      env: {WIKI_HANDOFF_DIR: handoff, WIKI_HANDOFF_BASELINE_PATH: baselinePath},
    })
    expect(built).toMatchObject({exitCode: 0, stdout: '{"changed":3,"deleted":1}\n', stderr: ''})
    expect(built.githubOutput).toBe('changed=true\n')
    const manifest = JSON.parse(readFileSync(join(handoff, 'manifest.json'), 'utf8')) as {
      changed: string[]
      deleted: string[]
    }
    expect(manifest.changed.toSorted()).toEqual([
      'knowledge/log.md',
      'knowledge/wiki/topics/new-topic.md',
      'knowledge/wiki/topics/polyglot-monorepo.md',
    ])
    expect(manifest.deleted).toEqual(['knowledge/wiki/repos/acme--widgets.md'])
    expect(readFileSync(join(handoff, 'files/knowledge/wiki/topics/polyglot-monorepo.md'), 'utf8')).toBe(edited)

    const applied = await run('wiki-handoff-apply', {
      cwd: checkout({}),
      env: {WIKI_HANDOFF_DIR: handoff, WIKI_HANDOFF_WORKSPACE: workspace},
    })
    expect(applied).toMatchObject({exitCode: 0, stdout: '{"applied":2,"deleted":1,"skipped":1}\n', stderr: ''})
    expect(readFileSync(join(workspace, 'knowledge/wiki/topics/polyglot-monorepo.md'), 'utf8')).toBe(edited)
    expect(readFileSync(join(workspace, 'knowledge/wiki/topics/new-topic.md'), 'utf8')).toBe(added)
    expect(existsSync(join(workspace, 'knowledge/wiki/repos/acme--widgets.md'))).toBe(false)
    // The shared catalog files are validated and never applied.
    expect(readFileSync(join(workspace, 'knowledge/log.md'), 'utf8')).toBe(LOG)
  })

  it('apply writes into the working directory when no workspace is named', async () => {
    const workspace = checkout({})
    const handoff = checkout({
      'manifest.json': JSON.stringify({changed: ['knowledge/wiki/topics/new.md'], deleted: []}),
      'files/knowledge/wiki/topics/new.md': 'new\n',
    })
    const result = await run('wiki-handoff-apply', {cwd: workspace, env: {WIKI_HANDOFF_DIR: handoff}})
    expect(result).toMatchObject({exitCode: 0, stdout: '{"applied":1,"deleted":0,"skipped":0}\n'})
    expect(readFileSync(join(workspace, 'knowledge/wiki/topics/new.md'), 'utf8')).toBe('new\n')
  })

  it('the build step writes changed=false and an empty manifest when nothing changed, and the upload gate reads it', async () => {
    const agent = repository(WIKI)
    const handoff = join(root, 'handoff-empty')
    const built = await run('wiki-handoff-build', {cwd: agent, env: {WIKI_HANDOFF_DIR: handoff}})
    expect(built).toMatchObject({exitCode: 0, stdout: '{"changed":0,"deleted":0}\n', githubOutput: 'changed=false\n'})
    expect(JSON.parse(readFileSync(join(handoff, 'manifest.json'), 'utf8'))).toEqual({changed: [], deleted: []})
  })

  it('the build step still prints its JSON when GITHUB_OUTPUT is unset or empty (fro-bot.yaml runs it with no output file)', async () => {
    for (const githubOutput of ['unset', 'empty'] as const) {
      const agent = repository(WIKI)
      const built = await run('wiki-handoff-build', {
        cwd: agent,
        env: {WIKI_HANDOFF_DIR: join(root, `handoff-${githubOutput}`)},
        githubOutput,
      })
      expect(built).toMatchObject({exitCode: 0, stdout: '{"changed":0,"deleted":0}\n', githubOutput: ''})
    }
  })

  it('apply refuses a manifest path that escapes the workspace and writes nothing', async () => {
    const workspace = checkout({'knowledge/index.md': INDEX})
    const handoff = checkout({
      'manifest.json': JSON.stringify({changed: ['../../escape.md'], deleted: []}),
      'files/x': 'x',
    })
    const result = await run('wiki-handoff-apply', {cwd: workspace, env: {WIKI_HANDOFF_DIR: handoff}})
    expect(result).toMatchObject({exitCode: 1, stdout: ''})
    expect(result.stderr).toBe(
      '::error::wiki-handoff-apply: wiki handoff path contains traversal or empty segments: ../../escape.md\n',
    )
    expect(existsSync(resolve(workspace, '../../escape.md'))).toBe(false)
  })

  it('apply refuses a symlink in the artifact and an absolute path', async () => {
    const workspace = checkout({})
    const linked = checkout({'manifest.json': JSON.stringify({changed: ['knowledge/wiki/topics/new.md'], deleted: []})})
    mkdirSync(join(linked, 'files/knowledge/wiki/topics'), {recursive: true})
    symlinkSync('/etc/hosts', join(linked, 'files/knowledge/wiki/topics/new.md'))
    const symlink = await run('wiki-handoff-apply', {cwd: workspace, env: {WIKI_HANDOFF_DIR: linked}})
    expect(symlink.stderr).toBe(
      '::error::wiki-handoff-apply: refusing symlink in wiki handoff: knowledge/wiki/topics/new.md\n',
    )
    const absolute = checkout({'manifest.json': JSON.stringify({changed: ['/etc/passwd.md'], deleted: []})})
    const abs = await run('wiki-handoff-apply', {cwd: workspace, env: {WIKI_HANDOFF_DIR: absolute}})
    expect(abs.stderr).toBe('::error::wiki-handoff-apply: wiki handoff path must be relative: /etc/passwd.md\n')
    expect(abs.exitCode).toBe(1)
  })

  it('the build step refuses a symlinked source and an out-of-scope path', async () => {
    const symlinked = repository(WIKI)
    symlinkSync('/etc/hosts', join(symlinked, 'knowledge/wiki/topics/link.md'))
    const link = await run('wiki-handoff-build', {cwd: symlinked, env: {WIKI_HANDOFF_DIR: join(root, 'handoff-link')}})
    expect(link.exitCode).toBe(1)
    expect(link.stderr).toContain('refusing symlink source: knowledge/wiki/topics/link.md')
    expect(link.githubOutput).toBe('')
    const outOfScope = repository(WIKI)
    writeFileSync(join(outOfScope, 'knowledge/wiki/topics/notes.txt'), 'x')
    const oos = await run('wiki-handoff-build', {cwd: outOfScope, env: {WIKI_HANDOFF_DIR: join(root, 'handoff-oos')}})
    expect(oos.exitCode).toBe(1)
    expect(oos.stderr).toContain('git status reported out-of-scope paths: knowledge/wiki/topics/notes.txt')
  })

  it.each([
    ['wiki-handoff-baseline', {WIKI_HANDOFF_BASELINE_PATH: join(root, 'unused-baseline.json')}],
    ['wiki-handoff-build', {WIKI_HANDOFF_DIR: join(root, 'unused-handoff')}],
    ['wiki-handoff-apply', {WIKI_HANDOFF_DIR: join(root, 'unused-apply')}],
  ])('%s: a missing variable fails with its message', async (script, env) => {
    const result = await run(script, {cwd: repository(WIKI)})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    const name = Object.keys(env)[0] ?? ''
    expect(result.stderr).toContain(`${name} is required`)
    if (script === 'wiki-handoff-apply') expect(result.stderr.startsWith('::error::wiki-handoff-apply: ')).toBe(true)
  })

  describe.each(['wiki-handoff-baseline', 'wiki-handoff-build', 'wiki-handoff-apply'])('%s', script => {
    it.each(USAGE_ARGV)('argv %s is a usage error that runs nothing', async arg => {
      const dir = join(root, `usage-${script}-${arg.replaceAll(/\W/gu, '')}`)
      const result = await run(script, {
        argv: [arg],
        cwd: repository(WIKI),
        env: {WIKI_HANDOFF_BASELINE_PATH: join(dir, 'b.json'), WIKI_HANDOFF_DIR: dir},
      })
      expect(result).toMatchObject({exitCode: 1, stdout: '', githubOutput: ''})
      expect(result.stderr).not.toBe('')
      expect(existsSync(dir)).toBe(false)
    })
  })
})

// ─── wiki-query and solutions-query ──────────────────────────────────────────────────────────────

const SOLUTION = `---\ntitle: Build breaks on release\nmodule: release\ntags: [build]\nproblem_type: build_error\nlast_updated: 2026-10-01\n---\n\nThe build breaks when release automation runs.\n`
const SOLUTIONS = {
  'docs/solutions/best-practices/release-build.md': SOLUTION,
  'docs/solutions/workflow-issues/private.md':
    '---\ntitle: Vault\nmodule: x\ntags: [build]\n---\n\nThe secretco/vault repository is involved in the build.\n',
  'docs/solutions/runtime-errors/bad.md': '---\ntitle: [unclosed\n---\n\nbuild\n',
}
const PRIVATE_REPOS =
  'version: 1\nrepos:\n  - owner: secretco\n    name: vault\n    private: true\n    node_id: R_x\n    database_id: 1\n'

describe('wiki-query (bun; fro-bot.yaml:592)', () => {
  const EVENT = {
    WIKI_QUERY_EVENT_NAME: 'issues',
    WIKI_QUERY_OWNER: 'acme',
    WIKI_QUERY_REPO: 'widgets',
    WIKI_QUERY_TITLE: 'build system',
  }

  it('prints the result JSON and writes the three outputs the agent step reads, which parse back to the same excerpt', async () => {
    const cwd = checkout(WIKI)
    const handoff = join(root, 'wiki-handoff-selected.json')
    const result = await run('wiki-query', {cwd, env: {...EVENT, WIKI_CONTEXT_HANDOFF_PATH: handoff}})
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    const printed = JSON.parse(result.stdout) as {excerpt: string; selectedPaths: string[]; byteLength: number}
    expect(printed.selectedPaths).toEqual([
      'knowledge/wiki/repos/acme--widgets.md',
      'knowledge/wiki/topics/polyglot-monorepo.md',
    ])
    const outputs = parseOutputs(result.githubOutput)
    expect(outputs.excerpt).toBe(printed.excerpt)
    expect(JSON.parse(outputs['selected-paths'] ?? '')).toEqual(printed.selectedPaths)
    expect(outputs['byte-length']).toBe(String(printed.byteLength))
    expect(JSON.parse(readFileSync(handoff, 'utf8'))).toEqual({selectedPaths: printed.selectedPaths})
    expect(statSync(handoff).mode & 0o777).toBe(0o600)
  })

  it('an empty excerpt is an empty output value, not a missing one', async () => {
    const result = await run('wiki-query', {
      cwd: checkout(WIKI),
      env: {WIKI_QUERY_EVENT_NAME: 'issues', WIKI_QUERY_TITLE: 'zzzz qqqq'},
    })
    expect(result.exitCode).toBe(0)
    expect(parseOutputs(result.githubOutput)).toEqual({excerpt: '', 'selected-paths': '[]', 'byte-length': '0'})
    expect(JSON.parse(result.stdout)).toEqual({excerpt: '', selectedPaths: [], byteLength: 0})
  })

  it('fails soft on a malformed page: warning, empty outputs, an empty handoff and exit 0', async () => {
    const handoff = join(root, 'wiki-handoff-broken.json')
    const cwd = checkout({...WIKI, 'knowledge/wiki/topics/broken.md': '---\ntype: [oops\n---\n\nbody\n'})
    const result = await run('wiki-query', {cwd, env: {...EVENT, WIKI_CONTEXT_HANDOFF_PATH: handoff}})
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('wiki-query:warn:baseline-query-failed\n')
    expect(parseOutputs(result.githubOutput)['selected-paths']).toBe('[]')
    expect(JSON.parse(readFileSync(handoff, 'utf8'))).toEqual({selectedPaths: []})
  })

  it('a handoff write failure warns and still exits 0 with the outputs written', async () => {
    const result = await run('wiki-query', {
      cwd: checkout(WIKI),
      env: {...EVENT, WIKI_CONTEXT_HANDOFF_PATH: join(root, 'missing-dir/handoff.json')},
    })
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('wiki-query:warn:handoff-write-failed\n')
    expect(parseOutputs(result.githubOutput).excerpt).not.toBe('')
  })

  it('works without GITHUB_OUTPUT', async () => {
    const result = await run('wiki-query', {cwd: checkout(WIKI), env: EVENT, githubOutput: 'unset'})
    expect(result.exitCode).toBe(0)
    expect(result.githubOutput).toBe('')
    expect(JSON.parse(result.stdout)).toHaveProperty('selectedPaths')
  })

  it.each(USAGE_ARGV)('argv %s is a usage error that queries nothing', async arg => {
    const result = await run('wiki-query', {argv: [arg], cwd: checkout(WIKI), env: EVENT})
    expect(result).toMatchObject({exitCode: 1, stdout: '', githubOutput: ''})
    expect(result.stderr).not.toBe('')
  })
})

describe('solutions-query (bun; fro-bot.yaml:614)', () => {
  const EVENT = {
    SOLUTIONS_QUERY_EVENT_NAME: 'issues',
    SOLUTIONS_QUERY_TITLE: 'release build',
    SOLUTIONS_QUERY_BODY: 'the build breaks',
  }
  const files = {...WIKI, ...SOLUTIONS, 'metadata/repos.yaml': PRIVATE_REPOS}

  it('excludes a doc that names a private repo and skips a malformed one, both with closed stderr lines, and keeps the rest', async () => {
    const result = await run('solutions-query', {cwd: checkout(files), env: EVENT})
    expect(result.exitCode).toBe(0)
    const printed = JSON.parse(result.stdout) as {excerpt: string; selectedPaths: string[]; byteLength: number}
    expect(printed.selectedPaths).toEqual(['docs/solutions/best-practices/release-build.md'])
    expect(result.stderr).toContain(
      'solutions-query: excluded 1 doc on privacy scan (path: docs/solutions/workflow-issues/private.md)',
    )
    expect(result.stderr).toContain(
      'solutions-query: skipped 1 doc on malformed frontmatter (path: docs/solutions/runtime-errors/bad.md)',
    )
    expect(result.stderr).not.toContain('secretco')
    const outputs = parseOutputs(result.githubOutput)
    expect(outputs.excerpt).toBe(printed.excerpt)
    expect(outputs['selected-paths']).toBe(JSON.stringify(printed.selectedPaths))
    expect(outputs['byte-length']).toBe(String(printed.byteLength))
  })

  it('falls back to an empty result when metadata/repos.yaml is unreadable', async () => {
    const result = await run('solutions-query', {cwd: checkout({...SOLUTIONS}), env: EVENT})
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain('could not read metadata/repos.yaml; privacy scan uses 0 private names')
  })

  it.each(USAGE_ARGV)('argv %s is a usage error that queries nothing', async arg => {
    const result = await run('solutions-query', {argv: [arg], cwd: checkout(files), env: EVENT})
    expect(result).toMatchObject({exitCode: 1, stdout: '', githubOutput: ''})
  })
})

// ─── wiki-context-expand (hand-parsed) ───────────────────────────────────────────────────────────

describe('wiki-context-expand (agent shell; fro-bot.yaml:657-658, README.md:402)', () => {
  const HANDOFF = JSON.stringify({selectedPaths: ['knowledge/wiki/repos/acme--widgets.md']})

  it('linked reads the handoff the baseline query wrote and returns the linked page', async () => {
    const cwd = checkout({...WIKI, 'handoff.json': HANDOFF})
    const result = await run('wiki-context-expand', {
      argv: ['linked'],
      cwd,
      env: {WIKI_CONTEXT_HANDOFF_PATH: join(cwd, 'handoff.json')},
    })
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('wiki-context-expand:linked:ok\n')
    const parsed = JSON.parse(result.stdout) as {status: string; mode: string; selectedPaths: string[]; excerpt: string}
    expect(parsed).toMatchObject({
      status: 'ok',
      mode: 'linked',
      selectedPaths: ['knowledge/wiki/topics/polyglot-monorepo.md'],
    })
    expect(parsed.excerpt).toContain('## Polyglot Monorepo')
  })

  it('query text that starts with a dash is the query, not a flag', async () => {
    const result = await run('wiki-context-expand', {argv: ['query', '-build system'], cwd: checkout(WIKI)})
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({status: 'ok', mode: 'query'})
    const flagLike = await run('wiki-context-expand', {argv: ['query', '--help'], cwd: checkout(WIKI)})
    expect(flagLike.stderr).not.toContain('Usage:')
    expect(JSON.parse(flagLike.stdout)).toMatchObject({mode: 'query', status: 'empty'})
  })

  it('--help and -h print usage on stderr and exit 0; bad arguments give the structured result and exit 1', async () => {
    for (const flag of ['--help', '-h']) {
      const help = await run('wiki-context-expand', {argv: [flag], cwd: checkout(WIKI)})
      expect(help).toMatchObject({
        exitCode: 0,
        stdout: '',
        stderr: 'Usage: wiki-context-expand <linked|query> [query text]\n',
      })
    }
    const bad = await run('wiki-context-expand', {argv: ['query'], cwd: checkout(WIKI)})
    expect(bad.exitCode).toBe(1)
    expect(bad.stderr).toBe('wiki-context-expand:error:bad-args\n')
    expect(JSON.parse(bad.stdout)).toMatchObject({status: 'empty', reason: 'bad-args'})
  })

  it('returns the same empty shape when the private token list cannot be read', async () => {
    const cwd = checkout({...WIKI, 'handoff.json': HANDOFF, 'metadata/repos.yaml': 'repos: [oops\n'})
    const result = await run('wiki-context-expand', {
      argv: ['linked'],
      cwd,
      env: {WIKI_CONTEXT_HANDOFF_PATH: join(cwd, 'handoff.json')},
    })
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain('wiki-context-expand:warn:private-token-load-failed')
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'empty',
      reason: 'private-token-load-failed',
      selectedPaths: [],
    })
  })
})

// ─── correction-lifecycle (hand-parsed) and render-corrections-context ───────────────────────────

const CORRECTIONS = `version: 1\ncorrections:\n  - id: 5ed43dce-b233-4f7d-987e-13dcc571504f\n    page_node_id: R_kgDOAAAAAA\n    span:\n      text: " and gateway"\n    attribution:\n      actor: marcusrbrown\n      recorded_at: 2026-10-23T01:33:52.274Z\n    state: active\n`
const ROOT_FILES = {
  'package.json': '{"name":"fixture","private":true}\n',
  'knowledge/corrections.yaml': CORRECTIONS,
  '.github/.keep': '',
}

describe('correction-lifecycle (agent shell; README.md:396)', () => {
  const RECORD = ['record', '--id', '11111111-2222-3333-4444-555555555555', '--node-id', 'R_kgDOAAAAAA', '--text']

  it('records into the sidecar with server-derived attribution and prints the JSON', async () => {
    const cwd = checkout(ROOT_FILES)
    const result = await run('correction-lifecycle', {
      argv: [...RECORD, 'a wrong claim'],
      cwd,
      env: {GITHUB_ACTOR: 'octocat'},
    })
    expect(result.exitCode).toBe(0)
    const printed = JSON.parse(result.stdout) as {
      ok: boolean
      command: string
      path: string
      correction: {attribution: {actor: string}}
    }
    expect(printed).toMatchObject({ok: true, command: 'record', path: 'knowledge/corrections.yaml'})
    expect(printed.correction.attribution.actor).toBe('octocat')
    expect(readFileSync(join(cwd, 'knowledge/corrections.yaml'), 'utf8')).toContain('a wrong claim')
  })

  it('has help, per-command help, and treats `record ... --text --help` as a value error', async () => {
    const cwd = checkout(ROOT_FILES)
    for (const argv of [['help'], ['--help']]) {
      const help = await run('correction-lifecycle', {argv, cwd})
      expect(help.exitCode).toBe(0)
      expect(JSON.parse(help.stdout)).toMatchObject({ok: true, command: 'help'})
    }
    const record = await run('correction-lifecycle', {argv: ['record', '--help'], cwd})
    expect(JSON.parse(record.stdout)).toMatchObject({
      ok: true,
      command: 'record',
      required: ['--id', '--node-id', '--text'],
    })
    const value = await run('correction-lifecycle', {argv: [...RECORD, '--help'], cwd, env: {GITHUB_ACTOR: 'octocat'}})
    expect(value.exitCode).toBe(1)
    expect(value.stdout).toBe('')
    expect(JSON.parse(value.stderr)).toMatchObject({ok: false, error: {code: 'INVALID_ARGUMENT'}})
    expect(readFileSync(join(cwd, 'knowledge/corrections.yaml'), 'utf8')).toBe(CORRECTIONS)
  })

  it('fails with MISSING_ACTOR when the server identity is absent and with INVALID_CONTEXT away from the root', async () => {
    const noActor = await run('correction-lifecycle', {argv: [...RECORD, 'x'], cwd: checkout(ROOT_FILES)})
    expect(JSON.parse(noActor.stderr)).toMatchObject({error: {code: 'MISSING_ACTOR'}})
    const wrongCwd = await run('correction-lifecycle', {
      argv: [...RECORD, 'x'],
      cwd: checkout({'knowledge/corrections.yaml': CORRECTIONS}),
      env: {GITHUB_ACTOR: 'octocat'},
    })
    expect(JSON.parse(wrongCwd.stderr)).toMatchObject({error: {code: 'INVALID_CONTEXT'}})
    expect(wrongCwd.exitCode).toBe(1)
  })
})

describe('render-corrections-context (bun; survey-repo.yaml:308 as `if bun ... 2>file`)', () => {
  const ENV = {REPO_NODE_ID: 'R_kgDOAAAAAA'}

  it('writes the data file for the page and exits 0 with nothing on stderr', async () => {
    const cwd = checkout(ROOT_FILES)
    const result = await run('render-corrections-context', {cwd, env: ENV})
    expect(result).toMatchObject({exitCode: 0, stdout: '', stderr: ''})
    const context = JSON.parse(readFileSync(join(cwd, '.github/corrections-context.json'), 'utf8')) as {
      contract: string
      corrections: unknown[]
    }
    expect(context.contract).toBe('corrections-data-v1')
    expect(context.corrections).toHaveLength(1)
  })

  it('prints the corrections:warning: line the step greps for before it fails, and exits non-zero', async () => {
    const cwd = checkout({...ROOT_FILES, 'knowledge/corrections.yaml': 'version: 9\ncorrections: []\n'})
    const result = await run('render-corrections-context', {cwd, env: ENV})
    expect(result.exitCode).toBe(1)
    const lines = result.stderr.split('\n')
    expect(lines[0]).toMatch(
      /^corrections:warning:\{"code":"INVALID_CORRECTIONS","path":"knowledge\/corrections\.yaml","message":/u,
    )
    expect(JSON.parse((lines[0] ?? '').slice('corrections:warning:'.length))).toMatchObject({
      code: 'INVALID_CORRECTIONS',
    })
    expect(lines.length).toBeGreaterThan(1)
    expect(existsSync(join(cwd, '.github/corrections-context.json'))).toBe(false)
  })

  it('a missing REPO_NODE_ID fails with its message', async () => {
    const result = await run('render-corrections-context', {cwd: checkout(ROOT_FILES)})
    expect(result).toMatchObject({exitCode: 1, stdout: ''})
    expect(result.stderr).toBe('REPO_NODE_ID is required\n')
  })

  it.each(USAGE_ARGV)('argv %s is a usage error that writes nothing', async arg => {
    const cwd = checkout(ROOT_FILES)
    const result = await run('render-corrections-context', {argv: [arg], cwd, env: ENV})
    expect(result.exitCode).toBe(1)
    expect(existsSync(join(cwd, '.github/corrections-context.json'))).toBe(false)
  })
})

// ─── rebuild-wiki-index ──────────────────────────────────────────────────────────────────────────

describe('rebuild-wiki-index (operator; no workflow caller)', () => {
  it('rebuilds the index from the wiki pages on disk', async () => {
    const cwd = checkout(WIKI)
    const result = await run('rebuild-wiki-index', {cwd})
    expect(result).toMatchObject({exitCode: 0, stdout: 'rebuilt knowledge/index.md from 2 wiki file(s)\n', stderr: ''})
    const index = readFileSync(join(cwd, 'knowledge/index.md'), 'utf8')
    expect(index).toContain('[[acme--widgets]]')
    expect(index).toContain('[[polyglot-monorepo]]')
  })

  it('--merge-logs a b merges both into knowledge/log.md', async () => {
    const logA = `${LOG}\n## [2026-10-01 00:00] ingest | acme/a\n\nA.\n`
    const logB = `${LOG}\n## [2026-10-02 00:00] ingest | acme/b\n\nB.\n`
    const cwd = checkout({...WIKI, 'a.md': logA, 'b.md': logB})
    const result = await run('rebuild-wiki-index', {argv: ['--merge-logs', 'a.md', 'b.md'], cwd})
    expect(result).toMatchObject({exitCode: 0, stdout: 'merged 2 log source(s) into knowledge/log.md\n'})
    const merged = readFileSync(join(cwd, 'knowledge/log.md'), 'utf8')
    expect(merged).toContain('acme/a')
    expect(merged).toContain('acme/b')
  })

  it.each([[['--help']], [['--help=false']], [['--bogus']], [['stray']], [['--merge-logs']]])(
    'argv %j is a usage error that writes nothing',
    async argv => {
      const cwd = checkout(WIKI)
      const result = await run('rebuild-wiki-index', {argv, cwd})
      expect(result).toMatchObject({exitCode: 1, stdout: ''})
      expect(readFileSync(join(cwd, 'knowledge/index.md'), 'utf8')).toBe(INDEX)
    },
  )
})

// ─── wiki-repair ─────────────────────────────────────────────────────────────────────────────────

const G = '/repos/fro-bot/.github'
const NO_TYPE = '---\ncreated: 2026-04-16\nupdated: 2026-04-16\n---\n\n# Gizmo Repo\n\nA gizmo.\n'
const REPAIR_FILES = {...WIKI, 'knowledge/wiki/topics/gizmo-repo.md': NO_TYPE}
const WRITE_ROUTES: readonly FakeRoute[] = [
  route('GET', `${G}/branches/data`, {b: {name: 'data', commit: {sha: 'tip1'}, protected: false}}),
  route('GET', `${G}/git/ref/heads/data`, {b: {object: {sha: 'tip1'}}}),
  route('GET', `${G}/git/commits/tip1`, {b: {sha: 'tip1', tree: {sha: 'tree1'}}}),
  route('POST', `${G}/git/blobs`, {s: 201, b: {sha: 'blob1'}}),
  route('POST', `${G}/git/trees`, {s: 201, b: {sha: 'tree2'}}),
  route('POST', `${G}/git/commits`, {s: 201, b: {sha: 'commit2'}}),
  route('PATCH', `${G}/git/refs/heads/data`, {b: {ref: 'refs/heads/data', object: {sha: 'commit2'}}}),
]

function repairEnv(cwd: string, extra: Readonly<Record<string, string | undefined>> = {}) {
  const grandfather = join(cwd, '.grandfather')
  mkdirSync(grandfather, {recursive: true})
  return {
    GITHUB_TOKEN: 'tok-repair',
    GRANDFATHER_WIKI_REPOS_DIR: grandfather,
    WIKI_REPAIR_RESULT_PATH: join(cwd, 'result.json'),
    WIKI_REPAIR_DRY_RUN: 'false',
    WIKI_REPAIR_DATA_TIP_SHA: 'tip1',
    WIKI_REPAIR_OWNER: 'fro-bot',
    WIKI_REPAIR_REPO: '.github',
    ...extra,
  }
}

describe('wiki-repair (bun; wiki-lint.yaml:206)', () => {
  it('a dry run counts the repair, writes the result file the summary step reads, makes no API call and exits 0', async () => {
    const cwd = checkout(REPAIR_FILES)
    const result = await run('wiki-repair', {
      cwd,
      env: repairEnv(cwd, {WIKI_REPAIR_DRY_RUN: 'true'}),
      routes: WRITE_ROUTES,
    })
    expect(result.exitCode).toBe(0)
    const counts = JSON.parse(result.stdout) as Record<string, unknown>
    expect(counts).toMatchObject({repairable_seen: 2, repaired: 1, aborted: 0, dry_run: true, noop: 0})
    expect(readFileSync(join(cwd, 'result.json'), 'utf8')).toBe(result.stdout)
    expect(requests()).toEqual([])
    expect(unhandledMutations()).toEqual([])
  })

  it('a live run commits once to data: the blob, tree, commit and ref update', async () => {
    const cwd = checkout(REPAIR_FILES)
    const result = await run('wiki-repair', {cwd, env: repairEnv(cwd), routes: WRITE_ROUTES})
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({repaired: 1, aborted: 0, dry_run: false})
    const writes = requests().filter(line => /^(?:POST|PATCH) /u.test(line))
    expect(writes.map(line => line.split(' ')[0])).toEqual(['POST', 'POST', 'POST', 'PATCH'])
    expect(writes[0]).toContain('type: topic')
    expect(writes[2]).toContain('chore(knowledge): repair wiki integrity findings')
    expect(unhandledMutations()).toEqual([])
  })

  it('a clean tree is a no-op with no API call', async () => {
    const cwd = checkout(WIKI)
    const result = await run('wiki-repair', {cwd, env: repairEnv(cwd), routes: WRITE_ROUTES})
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({noop: 1, repaired: 0})
    expect(requests()).toEqual([])
  })

  it('an escaped error is an abort: the result is still written, the error is annotated, and the job fails', async () => {
    const cwd = checkout(REPAIR_FILES)
    const result = await run('wiki-repair', {
      cwd,
      env: repairEnv(cwd),
      routes: [route('GET', `${G}/git/ref/heads/data`, {s: 401, b: {message: 'Bad credentials'}})],
    })
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(readFileSync(join(cwd, 'result.json'), 'utf8'))).toMatchObject({aborted: 1, repaired: 0})
    expect(result.stderr).toContain('::error::wiki-repair aborted:')
  })

  it('a missing tip SHA aborts with its message', async () => {
    const cwd = checkout(REPAIR_FILES)
    const result = await run('wiki-repair', {
      cwd,
      env: repairEnv(cwd, {WIKI_REPAIR_DATA_TIP_SHA: ''}),
      routes: WRITE_ROUTES,
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe(
      '::error::wiki-repair aborted: wiki-repair: WIKI_REPAIR_DATA_TIP_SHA is required in the environment\n',
    )
  })

  it.each(USAGE_ARGV)('argv %s is a usage error that repairs nothing', async arg => {
    const cwd = checkout(REPAIR_FILES)
    const result = await run('wiki-repair', {argv: [arg], cwd, env: repairEnv(cwd), routes: WRITE_ROUTES})
    expect(result).toMatchObject({exitCode: 1, stdout: ''})
    expect(existsSync(join(cwd, 'result.json'))).toBe(false)
    expect(requests()).toEqual([])
  })
})

// ─── wiki-lint-issues ────────────────────────────────────────────────────────────────────────────

describe('wiki-lint-issues (bun; wiki-lint.yaml:138)', () => {
  const finding = (fingerprint: string) => ({
    kind: 'broken-wikilink',
    severity: 'deterministic',
    path: 'knowledge/wiki/topics/x.md',
    target: 'gone',
    message: 'broken',
    fingerprint,
  })
  const report = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      schema_version: 1,
      fingerprint_version: 1,
      status: 'findings',
      scan_complete: true,
      snapshot_sha: 'abc123',
      generated_at: '2026-11-01T12:00:00.000Z',
      failure_class: null,
      repair_eligible: false,
      findings: [finding('aaa111'), finding('bbb222'), finding('ddd444')],
      freshness: [],
      counts: {findings_total: 3, findings_deterministic: 3, findings_advisory: 0, pages_scanned: 1, pages_stale: 0},
      ...overrides,
    })
  const marker = (fingerprint: string) => `<!-- wiki-lint:subject:fingerprint=${fingerprint} -->\n\nbody`
  const ISSUES = [
    {number: 11, state: 'open', body: marker('aaa111')},
    {number: 12, state: 'open', body: marker('ccc333')},
  ]
  const CLOSED = [{number: 21, state: 'closed', body: marker('bbb222')}]
  const API = (status = 201): readonly FakeRoute[] => [
    route('GET', `${G}/issues`, {q: 'state=open', b: ISSUES}),
    route('GET', `${G}/issues`, {q: 'state=closed', b: CLOSED}),
    route('POST', `${G}/issues`, {s: status, b: {number: 99}}),
    route('POST', String.raw`~^/repos/fro-bot/\.github/issues/\d+/comments$`, {s: 201, b: {id: 1}}),
    route('PATCH', String.raw`~^/repos/fro-bot/\.github/issues/\d+$`, {b: {number: 1}}),
  ]
  const ENV = {GITHUB_TOKEN: 'tok-lint', GITHUB_REPOSITORY_OWNER: 'fro-bot', GITHUB_REPOSITORY: 'fro-bot/.github'}

  function withSummary(cwd: string) {
    return {...ENV, GITHUB_STEP_SUMMARY: join(cwd, 'summary.md'), WIKI_LINT_JSON_PATH: 'wiki-lint-report.json'}
  }

  it('opens, comments on, reopens and closes, and writes the five counters the workflow reads and the summary table', async () => {
    const cwd = checkout({'wiki-lint-report.json': report()})
    const result = await run('wiki-lint-issues', {cwd, env: withSummary(cwd), routes: API()})
    expect(result).toMatchObject({exitCode: 0, stdout: ''})
    expect(parseOutputs(result.githubOutput)).toEqual({
      opened: '1',
      updated: '1',
      reopened: '1',
      closed: '1',
      failed: '0',
    })
    expect(readFileSync(join(cwd, 'summary.md'), 'utf8')).toContain('| Opened | 1 |')
    const writes = requests().filter(line => /^(?:POST|PATCH) /u.test(line))
    expect(writes).toHaveLength(5)
    expect(unhandledMutations()).toEqual([])
  })

  it('the optional positional is the report path when WIKI_LINT_JSON_PATH is unset', async () => {
    const cwd = checkout({
      'other.json': report({
        findings: [],
        status: 'clean',
        counts: {findings_total: 0, findings_deterministic: 0, findings_advisory: 0, pages_scanned: 1, pages_stale: 0},
      }),
    })
    const result = await run('wiki-lint-issues', {argv: ['other.json'], cwd, env: ENV, routes: API()})
    expect(result.exitCode).toBe(0)
    expect(parseOutputs(result.githubOutput)).toMatchObject({opened: '0', closed: '2'})
  })

  it('writes the outputs before it exits 1 on a failed issue call', async () => {
    const cwd = checkout({'wiki-lint-report.json': report()})
    const result = await run('wiki-lint-issues', {cwd, env: withSummary(cwd), routes: API(500)})
    expect(result.exitCode).toBe(1)
    expect(parseOutputs(result.githubOutput)).toMatchObject({opened: '0', failed: '1'})
    expect(result.stderr).toContain(
      'wiki-lint-issues: Failed to open issue "Wiki lint: broken-wikilink in knowledge/wiki/topics/x.md"',
    )
  })

  it.each([
    [
      'a malformed report',
      report({status: 'weird'}),
      'wiki-lint-issues: invalid report shape: status "weird" is not valid\n',
    ],
    [
      'an unknown schema_version',
      report({schema_version: 2}),
      'wiki-lint-issues: unknown schema_version 2, expected 1\n',
    ],
    ['unparseable JSON', '{nope', undefined],
  ])('%s exits 1 before any API call, with the outputs unwritten', async (_label, content, stderr) => {
    const cwd = checkout({'wiki-lint-report.json': content})
    const result = await run('wiki-lint-issues', {cwd, env: withSummary(cwd), routes: API()})
    expect(result).toMatchObject({exitCode: 1, stdout: '', githubOutput: ''})
    if (stderr === undefined)
      expect(result.stderr).toContain('wiki-lint-issues: failed to read wiki-lint-report.json: SyntaxError')
    else expect(result.stderr).toBe(stderr)
    expect(requests()).toEqual([])
  })

  it('a missing token reports the unhandled error and exits 1', async () => {
    const cwd = checkout({'wiki-lint-report.json': report()})
    const result = await run('wiki-lint-issues', {
      cwd,
      env: {...withSummary(cwd), GITHUB_TOKEN: undefined},
      routes: API(),
    })
    expect(result).toMatchObject({exitCode: 1, githubOutput: ''})
    expect(result.stderr).toBe('wiki-lint-issues: unhandled error: Error: GITHUB_TOKEN is not set\n')
  })

  it.each([[['--help']], [['--help=false']], [['--bogus']], [['a.json', 'b.json']]])(
    'argv %j is a usage error that syncs nothing',
    async argv => {
      const cwd = checkout({'wiki-lint-report.json': report()})
      const result = await run('wiki-lint-issues', {argv, cwd, env: withSummary(cwd), routes: API()})
      expect(result).toMatchObject({exitCode: 1, stdout: '', githubOutput: ''})
      expect(requests()).toEqual([])
    },
  )
})

// ─── the shims run nothing on import ─────────────────────────────────────────────────────────────

describe('the shims run nothing on import', () => {
  it.each([
    'wiki-change-detect',
    'wiki-handoff-baseline',
    'wiki-handoff-build',
    'wiki-handoff-apply',
    'wiki-query',
    'solutions-query',
    'wiki-context-expand',
    'correction-lifecycle',
    'render-corrections-context',
    'rebuild-wiki-index',
    'wiki-repair',
    'wiki-lint-issues',
  ])('importing scripts/%s.ts reads nothing, prints nothing and sets no exit code', async script => {
    const harness = join(root, `import-${script}.ts`)
    writeFileSync(
      harness,
      `await import(${JSON.stringify(join(repoRoot, 'scripts', `${script}.ts`))})\nprocess.stdout.write(String(process.exitCode))\n`,
    )
    chmodSync(harness, 0o644)
    const result = await spawnEntrypoint({
      entrypoint: harness,
      runtime: 'bun',
      runtimeArgs: ['--no-install', '--no-env-file'],
      env: {},
      cwd: checkout({}),
    })
    expect(result).toMatchObject({exitCode: 0, stdout: 'undefined', stderr: '', githubOutput: ''})
  })
})
