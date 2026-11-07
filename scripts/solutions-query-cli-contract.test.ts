/**
 * The `solutions-query` CLI contract, from the outside. Each case spawns the real `scripts/solutions-query.ts`
 * entrypoint in a child process (`@fro-bot/test-kit/spawn-entrypoint`) with a temp fixture checkout as cwd, and
 * pins what a workflow step reads: stdout, stderr, the exit code and `$GITHUB_OUTPUT`.
 *
 * The shapes are the ones the Unit 1 refactor was characterized against. A module that shadows a name the CLI
 * path needs (as `io` was once shadowed) throws inside the best-effort handler, and the step then prints an
 * empty result and a fallback line: the happy cases here fail on that, which no in-process test of the pure core sees.
 *
 * Dates are computed from the clock at run time, never written down.
 */

import {Buffer} from 'node:buffer'
import {chmod, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import process from 'node:process'
import {spawnEntrypoint} from '@fro-bot/test-kit/spawn-entrypoint'
import {afterAll, describe, expect, it} from 'vitest'

const ENTRYPOINT = resolve(import.meta.dirname, 'solutions-query.ts')

/** Old enough to be past the default 60-day staleness threshold, computed rather than written down. */
const DAY_MS = 24 * 60 * 60 * 1000
const STALE = new Date(Date.now() - 400 * DAY_MS).toISOString().slice(0, 10)

const HEAD = '# Prior Learnings\n\n'

const CACHE_PREFIX = `## Cache invalidation after a region rotation\nPath: docs/solutions/best-practices/cache-invalidation.md\nproblem_type: best_practice\nLast updated: ${STALE}\n`
const CACHE_BODY =
  '# Cache invalidation Clear region keys when the region rotates. Résumé café — multi-byte text for truncation.\n\n'
const CACHE_STALE = `${CACHE_PREFIX}(candidate — last updated ${STALE}, may be stale)\n\n${CACHE_BODY}`
const CACHE_FRESH = `${CACHE_PREFIX}\n${CACHE_BODY}`
const VERIFIED = `## Verified cache warming note\nPath: docs/solutions/best-practices/verified-doc.md\nproblem_type: best_practice\nLast updated: ${STALE}\n\nWarm the cache from synthetic access patterns.\n\n`
const NO_FRONTMATTER =
  '## docs/solutions/best-practices/no-frontmatter.md\nPath: docs/solutions/best-practices/no-frontmatter.md\nproblem_type: \nLast updated: unknown\n\nPlain document about cache eviction with no frontmatter at all.\n\n'
const LEAK =
  '## Secret leak in logs\nPath: docs/solutions/security-issues/leak.md\nproblem_type: security_issue\nLast updated: unknown\n\nMasking secret values in step logs.\n\n'

const PRIVACY_LINE =
  'solutions-query: excluded 1 doc on privacy scan (path: docs/solutions/workflow-issues/private-mention.md)'
const MALFORMED_LINE =
  'solutions-query: skipped 1 doc on malformed frontmatter (path: docs/solutions/workflow-issues/malformed.md): BAD_INDENT at line 2'
const NO_METADATA_LINE = 'solutions-query: could not read metadata/repos.yaml; privacy scan uses 0 private names'
const BAD_METADATA_LINE = 'solutions-query: could not parse metadata/repos.yaml; privacy scan uses 0 private names'
const UNREADABLE_LINE = 'solutions-query: could not read file (path: docs/solutions/best-practices/verified-doc.md)'
const FALLBACK_LINE = 'solutions-query: unexpected error, falling back to empty context'

const EMPTY_STDOUT = '{"excerpt":"","selectedPaths":[],"byteLength":0}\n'

const DOCS: Readonly<Record<string, string>> = {
  'docs/solutions/best-practices/cache-invalidation.md': [
    '---',
    'title: Cache invalidation after a region rotation',
    'module: cache-layer',
    'tags: [cache, redis]',
    'problem_type: best_practice',
    'applies_when:',
    '  - a region rotates mid-session',
    `last_updated: ${STALE}`,
    '---',
    '# Cache invalidation',
    '',
    'Clear region keys when the region rotates. Résumé café — multi-byte text for truncation.',
    '',
  ].join('\n'),
  'docs/solutions/best-practices/verified-doc.md': [
    '---',
    'title: Verified cache warming note',
    'module: cache-layer',
    'tags: [cache]',
    'problem_type: best_practice',
    `last_updated: ${STALE}`,
    'verified: true',
    '---',
    'Warm the cache from synthetic access patterns.',
    '',
  ].join('\n'),
  'docs/solutions/best-practices/no-frontmatter.md':
    'Plain document about cache eviction with no frontmatter at all.\n',
  'docs/solutions/security-issues/leak.md': [
    '---',
    'title: Secret leak in logs',
    'module: logging',
    'tags: [security, secret]',
    'problem_type: security_issue',
    '---',
    'Masking secret values in step logs.',
    '',
  ].join('\n'),
  'docs/solutions/workflow-issues/malformed.md': '---\ntitle: [unclosed\ntags: {a: b\n---\nbody about cache\n',
  'docs/solutions/workflow-issues/private-mention.md': [
    '---',
    'title: Mentions a hidden repo',
    'module: cache-layer',
    '---',
    'This cache note names acme-corp/hidden-repo directly.',
    '',
  ].join('\n'),
}

const REPOS_YAML = [
  'repos:',
  '  - owner: acme-corp',
  '    name: hidden-repo',
  '    private: true',
  "  - owner: '[REDACTED]'",
  "    name: '[REDACTED]'",
  '    private: true',
  '  - owner: acme-corp',
  '    name: public-repo',
  '    private: false',
  '',
].join('\n')

const WITH_METADATA: Readonly<Record<string, string>> = {...DOCS, 'metadata/repos.yaml': REPOS_YAML}

const cleanups: (() => Promise<void>)[] = []

afterAll(async () => {
  await Promise.all(cleanups.splice(0).map(async cleanup => cleanup()))
})

async function checkout(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'solutions-query-contract-'))
  cleanups.push(async () => rm(root, {recursive: true, force: true}))
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), {recursive: true})
    await writeFile(join(root, path), content)
  }
  return root
}

interface Outcome {
  readonly exitCode: number
  readonly stdout: string
  readonly stderrLines: string[]
  readonly stderr: string
  /** `$GITHUB_OUTPUT` with the random heredoc delimiter replaced by `UUID`. */
  readonly githubOutput: string
}

async function run(
  files: Readonly<Record<string, string>>,
  env: Readonly<Record<string, string>>,
  options: {argv?: readonly string[]; githubOutput?: 'file' | 'unset'; prepare?: (root: string) => Promise<void>} = {},
): Promise<Outcome> {
  const cwd = await checkout(files)
  await options.prepare?.(cwd)
  const result = await spawnEntrypoint({
    entrypoint: ENTRYPOINT,
    cwd,
    env,
    argv: options.argv ?? [],
    githubOutput: options.githubOutput ?? 'file',
  })
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    // Warning order follows the directory listing, which the file system decides; the set is the contract.
    stderrLines: result.stderr
      .split('\n')
      .filter(line => line !== '')
      .toSorted(),
    githubOutput: result.githubOutput
      .replaceAll(/<<[0-9a-f-]{36}\n/gu, '<<UUID\n')
      .replaceAll(/\n[0-9a-f-]{36}\n/gu, '\nUUID\n'),
  }
}

function result(excerpt: string, selectedPaths: readonly string[], byteLength: number): string {
  return `${JSON.stringify({excerpt, selectedPaths, byteLength})}\n`
}

function outputs(excerpt: string, selectedPaths: readonly string[], byteLength: number): string {
  const body = excerpt === '' ? 'excerpt=\n' : `excerpt<<UUID\n${excerpt}\nUUID\n`
  return `${body}selected-paths=${JSON.stringify(selectedPaths)}\nbyte-length=${String(byteLength)}\n`
}

const ALL_THREE = [
  'docs/solutions/best-practices/cache-invalidation.md',
  'docs/solutions/best-practices/verified-doc.md',
  'docs/solutions/best-practices/no-frontmatter.md',
]

describe('solutions-query CLI, spawned: a corpus with docs', () => {
  it('prints the ranked excerpt, appends the three outputs and warns about the skipped docs', async () => {
    const out = await run(WITH_METADATA, {
      SOLUTIONS_QUERY_EVENT_NAME: 'pull_request',
      SOLUTIONS_QUERY_OWNER: 'acme-corp',
      SOLUTIONS_QUERY_REPO: 'public-repo',
      SOLUTIONS_QUERY_TITLE: 'cache region rotation',
      SOLUTIONS_QUERY_BODY: 'warming the cache',
    })
    const excerpt = `${HEAD}${CACHE_STALE}${VERIFIED}${NO_FRONTMATTER}`

    expect(out.exitCode).toBe(0)
    expect(out.stdout).toBe(result(excerpt, ALL_THREE, 740))
    expect(out.githubOutput).toBe(outputs(excerpt, ALL_THREE, 740))
    expect(out.stderrLines).toEqual([MALFORMED_LINE, PRIVACY_LINE].toSorted())
  })

  it('prints no fallback line on the happy path', async () => {
    // The fallback line is what a failure inside the best-effort handler prints, with an empty result.
    const out = await run(WITH_METADATA, {SOLUTIONS_QUERY_TITLE: 'cache region rotation'})

    expect(out.stderr).not.toContain(FALLBACK_LINE)
    expect(out.stdout).not.toBe(EMPTY_STDOUT)
  })

  it('reads the event name from GITHUB_EVENT_NAME and boosts a security doc on a security event', async () => {
    const out = await run(WITH_METADATA, {SOLUTIONS_QUERY_TITLE: 'secret leak in logs', GITHUB_EVENT_NAME: 'issues'})
    const excerpt = `${HEAD}${LEAK}`

    expect(out.exitCode).toBe(0)
    expect(out.stdout).toBe(result(excerpt, ['docs/solutions/security-issues/leak.md'], 176))
    expect(out.githubOutput).toBe(outputs(excerpt, ['docs/solutions/security-issues/leak.md'], 176))
  })

  it('answers a query nothing matches with an empty result and empty outputs', async () => {
    const out = await run(WITH_METADATA, {SOLUTIONS_QUERY_TITLE: 'zzzzqqqq nothing'})

    expect(out.exitCode).toBe(0)
    expect(out.stdout).toBe(EMPTY_STDOUT)
    expect(out.githubOutput).toBe(outputs('', [], 0))
    expect(out.stderrLines).toEqual([MALFORMED_LINE, PRIVACY_LINE].toSorted())
  })

  it('answers a run with no query variables with an empty result', async () => {
    const out = await run(WITH_METADATA, {})

    expect(out.exitCode).toBe(0)
    expect(out.stdout).toBe(EMPTY_STDOUT)
    expect(out.stderr).not.toContain(FALLBACK_LINE)
  })

  it('cuts the excerpt at SOLUTIONS_QUERY_MAX_BYTES on a character boundary', async () => {
    const out = await run(WITH_METADATA, {SOLUTIONS_QUERY_TITLE: 'cache', SOLUTIONS_QUERY_MAX_BYTES: '300'})
    const excerpt = `${HEAD}${CACHE_STALE.slice(0, CACHE_STALE.indexOf('rotates. R') + 'rotates. R'.length)}…`

    expect(out.exitCode).toBe(0)
    expect(out.stdout).toBe(result(excerpt, ['docs/solutions/best-practices/cache-invalidation.md'], 299))
    expect(Buffer.byteLength(excerpt, 'utf8')).toBe(299)
  })

  it('drops the stale note when SOLUTIONS_QUERY_STALENESS_DAYS is larger than the doc age', async () => {
    const out = await run(WITH_METADATA, {SOLUTIONS_QUERY_TITLE: 'cache', SOLUTIONS_QUERY_STALENESS_DAYS: '100000'})
    const excerpt = `${HEAD}${CACHE_FRESH}${VERIFIED}${NO_FRONTMATTER}`

    expect(out.stdout).toBe(result(excerpt, ALL_THREE, 686))
    expect(out.stdout).not.toContain('may be stale')
  })

  it('still prints the result and exits 0 when GITHUB_OUTPUT is unset', async () => {
    const out = await run(WITH_METADATA, {SOLUTIONS_QUERY_TITLE: 'cache'}, {githubOutput: 'unset'})
    const excerpt = `${HEAD}${CACHE_STALE}${VERIFIED}${NO_FRONTMATTER}`

    expect(out.exitCode).toBe(0)
    expect(out.stdout).toBe(result(excerpt, ALL_THREE, 740))
    expect(out.githubOutput).toBe('')
  })

  it.skipIf(process.getuid?.() === 0)('skips a doc it cannot read, says so by path and keeps the rest', async () => {
    const out = await run(
      WITH_METADATA,
      {SOLUTIONS_QUERY_TITLE: 'cache'},
      {
        prepare: async root => {
          await chmod(join(root, 'docs/solutions/best-practices/verified-doc.md'), 0o000)
        },
      },
    )
    const excerpt = `${HEAD}${CACHE_STALE}${NO_FRONTMATTER}`

    expect(out.exitCode).toBe(0)
    expect(out.stdout).toBe(
      result(
        excerpt,
        ['docs/solutions/best-practices/cache-invalidation.md', 'docs/solutions/best-practices/no-frontmatter.md'],
        555,
      ),
    )
    expect(out.stderrLines).toEqual([MALFORMED_LINE, PRIVACY_LINE, UNREADABLE_LINE].toSorted())
  })
})

describe('solutions-query CLI, spawned: the private-name list', () => {
  it('uses zero private names and says so when metadata/repos.yaml is missing', async () => {
    const out = await run(DOCS, {SOLUTIONS_QUERY_TITLE: 'cache region rotation'})

    // Without the list the doc that names a hidden repo is no longer excluded; the CLI is best-effort by design.
    expect(out.exitCode).toBe(0)
    expect(out.stderrLines).toContain(NO_METADATA_LINE)
    expect(out.stderrLines).toContain(MALFORMED_LINE)
    expect(out.stderrLines).not.toContain(PRIVACY_LINE)
    expect(out.stdout).not.toBe(EMPTY_STDOUT)
    expect(JSON.parse(out.stdout) as {selectedPaths: string[]}).toMatchObject({
      selectedPaths: expect.arrayContaining(ALL_THREE) as string[],
    })
  })

  it('answers an empty result with exit 0 when there is no corpus and no metadata', async () => {
    const out = await run({}, {SOLUTIONS_QUERY_TITLE: 'cache'})

    expect(out.exitCode).toBe(0)
    expect(out.stdout).toBe(EMPTY_STDOUT)
    expect(out.stderrLines).toEqual([NO_METADATA_LINE])
    expect(out.githubOutput).toBe(outputs('', [], 0))
  })

  it('says it could not parse a malformed repos.yaml and answers empty', async () => {
    const out = await run({'metadata/repos.yaml': 'repos: [unclosed\n'}, {SOLUTIONS_QUERY_TITLE: 'cache'})

    expect(out.exitCode).toBe(0)
    expect(out.stdout).toBe(EMPTY_STDOUT)
    expect(out.stderrLines).toEqual([BAD_METADATA_LINE])
  })

  it('treats a repos.yaml that is a bare scalar as no private names, silently', async () => {
    const out = await run({'metadata/repos.yaml': 'just a string\n'}, {SOLUTIONS_QUERY_TITLE: 'cache'})

    expect(out.exitCode).toBe(0)
    expect(out.stdout).toBe(EMPTY_STDOUT)
    expect(out.stderr).toBe('')
  })
})

describe('solutions-query CLI, spawned: argv', () => {
  const USAGE = [
    'solutions-query',
    '',
    'Usage:',
    '  $ solutions-query [options]',
    '',
    'Commands:',
    '  solutions-query',
    '',
    'Options:',
    '  -h, --help  Display this message',
    '',
  ].join('\n')

  it('treats --help as a usage error: usage on stderr, exit 1, no result', async () => {
    const out = await run(WITH_METADATA, {SOLUTIONS_QUERY_TITLE: 'cache'}, {argv: ['--help']})

    expect(out.exitCode).toBe(1)
    expect(out.stdout).toBe('')
    expect(out.stderr).toBe(USAGE)
    expect(out.githubOutput).toBe('')
  })

  it('treats a stray argument as an unknown command: exit 1, no result', async () => {
    const out = await run(WITH_METADATA, {SOLUTIONS_QUERY_TITLE: 'cache'}, {argv: ['extra']})

    expect(out.exitCode).toBe(1)
    expect(out.stdout).toBe('')
    expect(out.stderr).toBe(
      `Unknown command: extra\n\n${USAGE.replace('solutions-query [options]', 'solutions-query <command> [options]')}`,
    )
    expect(out.githubOutput).toBe('')
  })
})
