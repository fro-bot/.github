/**
 * The baseline wiki query and a page whose frontmatter cannot be read.
 *
 * The first block is a characterization over a fixture wiki in which every page is readable. Its inline snapshots
 * were captured on the code before the change that skips such a page; they pin ranking, the byte budget and the
 * output format byte for byte, so that change cannot move them. The blocks after it pin the skip itself.
 */
import {spawnSync} from 'node:child_process'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import process from 'node:process'

import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {assembleWikiContext, runWikiQuery} from './wiki-query.ts'

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu

const FIXTURE_WIKI: Readonly<Record<string, string>> = {
  'knowledge/index.md': '# Wiki Index\n\n- [[fro-bot--agent]] — Fro Bot Agent\n',
  'knowledge/wiki/repos/fro-bot--agent.md': [
    '---',
    'type: repo',
    'title: Fro Bot Agent',
    'created: 2026-04-16',
    'updated: 2026-04-16',
    'tags: [agent, vitest, octokit]',
    '---',
    '',
    'Fro Bot Agent uses Vitest and Octokit in its workflow scripts.',
    '',
  ].join('\n'),
  'knowledge/wiki/repos/fro-bot--dashboard.md': [
    '---',
    'type: repo',
    'title: Fro Bot Dashboard',
    'tags: [dashboard, github]',
    '---',
    '',
    'The dashboard reads GitHub Actions run data and shows workflow health.',
    '',
  ].join('\n'),
  'knowledge/wiki/topics/vitest.md': [
    '---',
    'type: topic',
    'title: Vitest',
    'created: 2026-04-16',
    'updated: 2026-04-16',
    'tags: [testing]',
    '---',
    '',
    'Vitest is the repo test runner.',
    '',
  ].join('\n'),
  'knowledge/wiki/topics/github-actions-ci.md': [
    '---',
    'type: topic',
    'title: GitHub Actions CI',
    'tags: [ci, workflows, actions]',
    '---',
    '',
    'GitHub Actions CI should pin actions and validate workflows.',
    '',
  ].join('\n'),
  'knowledge/wiki/topics/no-frontmatter.md': 'A page with no frontmatter block mentions workflows and vitest.\n',
  'knowledge/wiki/topics/crlf-page.md':
    '---\r\ntype: topic\r\ntitle: CRLF Page\r\ntags: [vitest]\r\n---\r\n\r\nA CRLF page about vitest.\r\n',
  'knowledge/wiki/entities/octokit.md': [
    '---',
    'type: entity',
    'title: Octokit',
    'tags: [github]',
    '---',
    '',
    'Octokit powers GitHub API access.',
    '',
  ].join('\n'),
  'knowledge/wiki/comparisons/vitest-vs-jest.md': [
    '---',
    'type: comparison',
    'title: Vitest vs Jest',
    'tags: [testing]',
    '---',
    '',
    'Vitest and Jest compared for the agent test runner.',
    '',
  ].join('\n'),
}

async function writeWiki(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path)
    await mkdir(dirname(target), {recursive: true})
    await writeFile(target, content)
  }
}

interface CliRun {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
  readonly githubOutput: string
  readonly handoff: string
}

/** Run the real `scripts/wiki-query.ts` against a temp checkout holding `files`. */
async function runCli(files: Readonly<Record<string, string>>, env: Record<string, string>): Promise<CliRun> {
  const dir = await mkdtemp(join(tmpdir(), 'wiki-query-char-'))
  try {
    await writeWiki(dir, files)
    const githubOutput = join(dir, 'github-output.txt')
    const handoffPath = join(dir, 'handoff.json')
    const result = spawnSync('node', [join(import.meta.dirname, '..', '..', '..', 'scripts', 'wiki-query.ts')], {
      cwd: dir,
      encoding: 'utf8',
      env: {...process.env, GITHUB_OUTPUT: githubOutput, WIKI_CONTEXT_HANDOFF_PATH: handoffPath, ...env},
    })
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      // The runner picks a random heredoc delimiter for the multi-line `excerpt` value.
      githubOutput: (await readFile(githubOutput, 'utf8').catch(() => '')).replaceAll(UUID_PATTERN, '<delimiter>'),
      handoff: await readFile(handoffPath, 'utf8').catch(() => ''),
    }
  } finally {
    await rm(dir, {recursive: true, force: true})
  }
}

function pick(result: ReturnType<typeof assembleWikiContext>): string {
  return JSON.stringify({
    excerpt: result.excerpt,
    selectedPaths: result.selectedPaths,
    byteLength: result.byteLength,
  })
}

describe('baseline wiki query over a fixture wiki with no bad page', () => {
  it('ranks a pull request event with a repo-local target', () => {
    const result = assembleWikiContext({
      files: {...FIXTURE_WIKI},
      event: {
        eventName: 'pull_request',
        owner: 'fro-bot',
        repo: 'agent',
        title: 'feat: add vitest coverage',
        body: 'Octokit and GitHub Actions workflows change.',
      },
    })

    expect(pick(result)).toMatchInlineSnapshot(
      `"{"excerpt":"# Wiki Context\\n\\n## Fro Bot Agent\\nPath: knowledge/wiki/repos/fro-bot--agent.md\\nType: repo\\n\\nFro Bot Agent uses Vitest and Octokit in its workflow scripts.\\n\\n## Fro Bot Dashboard\\nPath: knowledge/wiki/repos/fro-bot--dashboard.md\\nType: repo\\n\\nThe dashboard reads GitHub Actions run data and shows workflow health.\\n\\n## GitHub Actions CI\\nPath: knowledge/wiki/topics/github-actions-ci.md\\nType: topic\\n\\nGitHub Actions CI should pin actions and validate workflows.\\n\\n## Vitest\\nPath: knowledge/wiki/topics/vitest.md\\nType: topic\\n\\nVitest is the repo test runner.\\n\\n## Octokit\\nPath: knowledge/wiki/entities/octokit.md\\nType: entity\\n\\nOctokit powers GitHub API access.\\n\\n## CRLF Page\\nPath: knowledge/wiki/topics/crlf-page.md\\nType: topic\\n\\nA CRLF page about vitest.\\n\\n## no-frontmatter\\nPath: knowledge/wiki/topics/no-frontmatter.md\\nType: topic\\n\\nA page with no frontmatter block mentions workflows and vitest.\\n\\n## Vitest vs Jest\\nPath: knowledge/wiki/comparisons/vitest-vs-jest.md\\nType: comparison\\n\\nVitest and Jest compared for the agent test runner.\\n\\n","selectedPaths":["knowledge/wiki/repos/fro-bot--agent.md","knowledge/wiki/repos/fro-bot--dashboard.md","knowledge/wiki/topics/github-actions-ci.md","knowledge/wiki/topics/vitest.md","knowledge/wiki/entities/octokit.md","knowledge/wiki/topics/crlf-page.md","knowledge/wiki/topics/no-frontmatter.md","knowledge/wiki/comparisons/vitest-vs-jest.md"],"byteLength":1024}"`,
    )
  })

  it('ranks a schedule event with no repo target', () => {
    const result = assembleWikiContext({
      files: {...FIXTURE_WIKI},
      event: {eventName: 'schedule', title: 'Daily oversight', body: 'Audit workflows, vitest and github usage.'},
    })

    expect(pick(result)).toMatchInlineSnapshot(
      `"{"excerpt":"# Wiki Context\\n\\n## GitHub Actions CI\\nPath: knowledge/wiki/topics/github-actions-ci.md\\nType: topic\\n\\nGitHub Actions CI should pin actions and validate workflows.\\n\\n## Vitest\\nPath: knowledge/wiki/topics/vitest.md\\nType: topic\\n\\nVitest is the repo test runner.\\n\\n## CRLF Page\\nPath: knowledge/wiki/topics/crlf-page.md\\nType: topic\\n\\nA CRLF page about vitest.\\n\\n## no-frontmatter\\nPath: knowledge/wiki/topics/no-frontmatter.md\\nType: topic\\n\\nA page with no frontmatter block mentions workflows and vitest.\\n\\n## Octokit\\nPath: knowledge/wiki/entities/octokit.md\\nType: entity\\n\\nOctokit powers GitHub API access.\\n\\n## Vitest vs Jest\\nPath: knowledge/wiki/comparisons/vitest-vs-jest.md\\nType: comparison\\n\\nVitest and Jest compared for the agent test runner.\\n\\n## Fro Bot Agent\\nPath: knowledge/wiki/repos/fro-bot--agent.md\\nType: repo\\n\\nFro Bot Agent uses Vitest and Octokit in its workflow scripts.\\n\\n## Fro Bot Dashboard\\nPath: knowledge/wiki/repos/fro-bot--dashboard.md\\nType: repo\\n\\nThe dashboard reads GitHub Actions run data and shows workflow health.\\n\\n","selectedPaths":["knowledge/wiki/topics/github-actions-ci.md","knowledge/wiki/topics/vitest.md","knowledge/wiki/topics/crlf-page.md","knowledge/wiki/topics/no-frontmatter.md","knowledge/wiki/entities/octokit.md","knowledge/wiki/comparisons/vitest-vs-jest.md","knowledge/wiki/repos/fro-bot--agent.md","knowledge/wiki/repos/fro-bot--dashboard.md"],"byteLength":1024}"`,
    )
  })

  it('truncates at the byte budget', () => {
    const result = assembleWikiContext({
      files: {...FIXTURE_WIKI},
      maxBytes: 300,
      event: {eventName: 'issues', owner: 'fro-bot', repo: 'agent', title: 'vitest workflows github'},
    })

    expect(pick(result)).toMatchInlineSnapshot(
      `"{"excerpt":"# Wiki Context\\n\\n## Fro Bot Agent\\nPath: knowledge/wiki/repos/fro-bot--agent.md\\nType: repo\\n\\nFro Bot Agent uses Vitest and Octokit in its workflow scripts.\\n\\n## Fro Bot Dashboard\\nPath: knowledge/wiki/repos/fro-bot--dashboard.md\\nType: repo\\n\\nThe dashboard reads GitHub Actions run data and shows workflo…","selectedPaths":["knowledge/wiki/repos/fro-bot--agent.md","knowledge/wiki/repos/fro-bot--dashboard.md"],"byteLength":300}"`,
    )
  })

  it('prints one JSON line, the outputs and the handoff through the real CLI', async () => {
    const run = await runCli(FIXTURE_WIKI, {
      WIKI_QUERY_EVENT_NAME: 'pull_request',
      WIKI_QUERY_OWNER: 'fro-bot',
      WIKI_QUERY_REPO: 'agent',
      WIKI_QUERY_TITLE: 'feat: add vitest coverage',
      WIKI_QUERY_BODY: 'Octokit and GitHub Actions workflows change.',
    })

    expect(run.status).toBe(0)
    expect(run.stderr).toBe('')
    expect(run.stdout).toMatchInlineSnapshot(`
      "{"excerpt":"# Wiki Context\\n\\n## Fro Bot Agent\\nPath: knowledge/wiki/repos/fro-bot--agent.md\\nType: repo\\n\\nFro Bot Agent uses Vitest and Octokit in its workflow scripts.\\n\\n## Fro Bot Dashboard\\nPath: knowledge/wiki/repos/fro-bot--dashboard.md\\nType: repo\\n\\nThe dashboard reads GitHub Actions run data and shows workflow health.\\n\\n## GitHub Actions CI\\nPath: knowledge/wiki/topics/github-actions-ci.md\\nType: topic\\n\\nGitHub Actions CI should pin actions and validate workflows.\\n\\n## Vitest\\nPath: knowledge/wiki/topics/vitest.md\\nType: topic\\n\\nVitest is the repo test runner.\\n\\n## Octokit\\nPath: knowledge/wiki/entities/octokit.md\\nType: entity\\n\\nOctokit powers GitHub API access.\\n\\n## CRLF Page\\nPath: knowledge/wiki/topics/crlf-page.md\\nType: topic\\n\\nA CRLF page about vitest.\\n\\n## no-frontmatter\\nPath: knowledge/wiki/topics/no-frontmatter.md\\nType: topic\\n\\nA page with no frontmatter block mentions workflows and vitest.\\n\\n## Vitest vs Jest\\nPath: knowledge/wiki/comparisons/vitest-vs-jest.md\\nType: comparison\\n\\nVitest and Jest compared for the agent test runner.\\n\\n","selectedPaths":["knowledge/wiki/repos/fro-bot--agent.md","knowledge/wiki/repos/fro-bot--dashboard.md","knowledge/wiki/topics/github-actions-ci.md","knowledge/wiki/topics/vitest.md","knowledge/wiki/entities/octokit.md","knowledge/wiki/topics/crlf-page.md","knowledge/wiki/topics/no-frontmatter.md","knowledge/wiki/comparisons/vitest-vs-jest.md"],"byteLength":1024}
      "
    `)
    expect(run.githubOutput).toMatchInlineSnapshot(`
      "excerpt<<<delimiter>
      # Wiki Context

      ## Fro Bot Agent
      Path: knowledge/wiki/repos/fro-bot--agent.md
      Type: repo

      Fro Bot Agent uses Vitest and Octokit in its workflow scripts.

      ## Fro Bot Dashboard
      Path: knowledge/wiki/repos/fro-bot--dashboard.md
      Type: repo

      The dashboard reads GitHub Actions run data and shows workflow health.

      ## GitHub Actions CI
      Path: knowledge/wiki/topics/github-actions-ci.md
      Type: topic

      GitHub Actions CI should pin actions and validate workflows.

      ## Vitest
      Path: knowledge/wiki/topics/vitest.md
      Type: topic

      Vitest is the repo test runner.

      ## Octokit
      Path: knowledge/wiki/entities/octokit.md
      Type: entity

      Octokit powers GitHub API access.

      ## CRLF Page
      Path: knowledge/wiki/topics/crlf-page.md
      Type: topic

      A CRLF page about vitest.

      ## no-frontmatter
      Path: knowledge/wiki/topics/no-frontmatter.md
      Type: topic

      A page with no frontmatter block mentions workflows and vitest.

      ## Vitest vs Jest
      Path: knowledge/wiki/comparisons/vitest-vs-jest.md
      Type: comparison

      Vitest and Jest compared for the agent test runner.


      <delimiter>
      selected-paths=["knowledge/wiki/repos/fro-bot--agent.md","knowledge/wiki/repos/fro-bot--dashboard.md","knowledge/wiki/topics/github-actions-ci.md","knowledge/wiki/topics/vitest.md","knowledge/wiki/entities/octokit.md","knowledge/wiki/topics/crlf-page.md","knowledge/wiki/topics/no-frontmatter.md","knowledge/wiki/comparisons/vitest-vs-jest.md"]
      byte-length=1024
      "
    `)
    expect(run.handoff).toMatchInlineSnapshot(`
      "{"selectedPaths":["knowledge/wiki/repos/fro-bot--agent.md","knowledge/wiki/repos/fro-bot--dashboard.md","knowledge/wiki/topics/github-actions-ci.md","knowledge/wiki/topics/vitest.md","knowledge/wiki/entities/octokit.md","knowledge/wiki/topics/crlf-page.md","knowledge/wiki/topics/no-frontmatter.md","knowledge/wiki/comparisons/vitest-vs-jest.md"]}
      "
    `)
  })
})

const SENTINEL = 'SENTINEL-9f3a71c2'
const EVENT_ENV = {
  WIKI_QUERY_EVENT_NAME: 'pull_request',
  WIKI_QUERY_OWNER: 'fro-bot',
  WIKI_QUERY_REPO: 'agent',
  WIKI_QUERY_TITLE: 'feat: add vitest coverage',
  WIKI_QUERY_BODY: 'Octokit and GitHub Actions workflows change.',
}
const EVENT = {
  eventName: 'pull_request',
  owner: 'fro-bot',
  repo: 'agent',
  title: 'feat: add vitest coverage',
  body: 'Octokit and GitHub Actions workflows change.',
}

const UNCLOSED_PATH = 'knowledge/wiki/topics/zz-unclosed-page.md'
const BAD_YAML_PATH = 'knowledge/wiki/topics/aa-bad-yaml-page.md'

// Every bad page matches the event ("vitest", "workflows"), so a page that was not skipped would be ranked in.
const UNCLOSED_PAGE = `---\ntype: topic\ntitle: ${SENTINEL}\ntags: [vitest, ${SENTINEL}]\n\nBody ${SENTINEL} vitest workflows.\n`
const BAD_YAML_PAGE = `---\ntype: topic\ntitle: ${SENTINEL}\ntags: [vitest, ${SENTINEL} unterminated\n---\n\nBody ${SENTINEL} vitest workflows.\n`

const UNCLOSED_WARNING = `wiki-query:warn:page-skipped path="${UNCLOSED_PATH}" reason=unclosed-frontmatter\n`
const BAD_YAML_WARNING = `wiki-query:warn:page-skipped path="${BAD_YAML_PATH}" reason=invalid-frontmatter\n`

const EMPTY_STDOUT = '{"excerpt":"","selectedPaths":[],"byteLength":0}\n'

describe('assembleWikiContext: one page with unreadable frontmatter among readable ones', () => {
  it.each([
    ['unclosed block', UNCLOSED_PATH, UNCLOSED_PAGE, 'unclosed-frontmatter'],
    ['invalid YAML', BAD_YAML_PATH, BAD_YAML_PAGE, 'invalid-frontmatter'],
  ])(
    'leaves out a page with %s, ranks the readable ones as before and reports the page',
    (_label, path, page, reason) => {
      const clean = assembleWikiContext({files: {...FIXTURE_WIKI}, event: EVENT})
      const result = assembleWikiContext({files: {...FIXTURE_WIKI, [path]: page}, event: EVENT})

      expect(pick(result)).toBe(pick(clean))
      expect(result.selectedPaths).not.toContain(path)
      expect(result.excerpt).not.toContain(SENTINEL)
      expect(result.skippedPages).toEqual([{path, reason}])
    },
  )

  it('reports nothing when every page is readable', () => {
    expect(assembleWikiContext({files: {...FIXTURE_WIKI}, event: EVENT}).skippedPages).toEqual([])
  })

  it('reports two bad pages in path order, whatever the order of the files', () => {
    const expected = [
      {path: BAD_YAML_PATH, reason: 'invalid-frontmatter'},
      {path: UNCLOSED_PATH, reason: 'unclosed-frontmatter'},
    ]
    const forward = assembleWikiContext({
      files: {...FIXTURE_WIKI, [UNCLOSED_PATH]: UNCLOSED_PAGE, [BAD_YAML_PATH]: BAD_YAML_PAGE},
      event: EVENT,
    })
    const reversed = assembleWikiContext({
      files: {...FIXTURE_WIKI, [BAD_YAML_PATH]: BAD_YAML_PAGE, [UNCLOSED_PATH]: UNCLOSED_PAGE},
      event: EVENT,
    })

    expect(forward.skippedPages).toEqual(expected)
    expect(reversed.skippedPages).toEqual(expected)
  })

  it('still throws when every wiki page is unreadable, as before', () => {
    const files = {
      'knowledge/index.md': '# Wiki Index\n',
      [UNCLOSED_PATH]: UNCLOSED_PAGE,
      [BAD_YAML_PATH]: BAD_YAML_PAGE,
    }

    expect(() => assembleWikiContext({files, event: EVENT})).toThrow(
      'Invalid wiki frontmatter in knowledge/wiki/topics/',
    )
  })

  it('does not throw for a wiki with no page at all', () => {
    const result = assembleWikiContext({files: {'knowledge/index.md': '# Wiki Index\n'}, event: EVENT})

    expect(pick(result)).toBe('{"excerpt":"","selectedPaths":[],"byteLength":0}')
    expect(result.skippedPages).toEqual([])
  })
})

describe('wiki-query CLI: a page with unreadable frontmatter', () => {
  it.each([
    ['unclosed block', UNCLOSED_PATH, UNCLOSED_PAGE, UNCLOSED_WARNING],
    ['invalid YAML', BAD_YAML_PATH, BAD_YAML_PAGE, BAD_YAML_WARNING],
  ])(
    'with %s is skipped: same context, outputs and handoff as without it, one warning, exit 0',
    async (_label, path, page, warning) => {
      const clean = await runCli(FIXTURE_WIKI, EVENT_ENV)
      const run = await runCli({...FIXTURE_WIKI, [path]: page}, EVENT_ENV)

      expect(run.status).toBe(0)
      expect(run.stderr).toBe(warning)
      expect(run.stdout).toBe(clean.stdout)
      expect(run.githubOutput).toBe(clean.githubOutput)
      expect(run.handoff).toBe(clean.handoff)
    },
  )

  it('reports two bad pages as two warnings in path order', async () => {
    const run = await runCli(
      {...FIXTURE_WIKI, [UNCLOSED_PATH]: UNCLOSED_PAGE, [BAD_YAML_PATH]: BAD_YAML_PAGE},
      EVENT_ENV,
    )

    expect(run.status).toBe(0)
    expect(run.stderr).toBe(`${BAD_YAML_WARNING}${UNCLOSED_WARNING}`)
  })

  it('carries no text from a bad page on stdout, stderr, the outputs or the handoff', async () => {
    const run = await runCli(
      {...FIXTURE_WIKI, [UNCLOSED_PATH]: UNCLOSED_PAGE, [BAD_YAML_PATH]: BAD_YAML_PAGE},
      EVENT_ENV,
    )

    expect(run.stderr).not.toBe('')
    for (const surface of [run.stdout, run.stderr, run.githubOutput, run.handoff]) {
      expect(surface).not.toContain(SENTINEL)
    }
  })

  it("keeps today's fail-soft result when every page is unreadable", async () => {
    const files = {
      'knowledge/index.md': '# Wiki Index\n',
      [UNCLOSED_PATH]: UNCLOSED_PAGE,
      [BAD_YAML_PATH]: BAD_YAML_PAGE,
    }
    const run = await runCli(files, EVENT_ENV)

    expect(run.status).toBe(0)
    expect(run.stderr).toBe('wiki-query:warn:baseline-query-failed\n')
    expect(run.stdout).toBe(EMPTY_STDOUT)
    expect(run.githubOutput).toContain('selected-paths=[]')
    expect(JSON.parse(run.handoff)).toEqual({selectedPaths: []})
  })

  it("keeps today's fail-soft result when the wiki cannot be read at all", async () => {
    const withoutIndex = Object.fromEntries(
      Object.entries(FIXTURE_WIKI).filter(([path]) => path !== 'knowledge/index.md'),
    )
    const run = await runCli(withoutIndex, EVENT_ENV)

    expect(run.status).toBe(0)
    expect(run.stderr).toBe('wiki-query:warn:baseline-query-failed\n')
    expect(run.stdout).toBe(EMPTY_STDOUT)
    expect(JSON.parse(run.handoff)).toEqual({selectedPaths: []})
  })
})

describe('wiki-query CLI: the path in a warning is safe to put in a Markdown summary', () => {
  const HOSTILE_NAME = 'x [a](http:evil) <img src=x onerror=1> "q" `b` _i_ *s* ~ | é.md'
  const HOSTILE_PATH = `knowledge/wiki/topics/${HOSTILE_NAME}`

  it('keeps an ordinary path readable and percent-encodes everything else', async () => {
    const run = await runCli({...FIXTURE_WIKI, 'knowledge/wiki/topics/a b.md': UNCLOSED_PAGE}, EVENT_ENV)

    expect(run.stderr).toBe(
      'wiki-query:warn:page-skipped path="knowledge/wiki/topics/a%20b.md" reason=unclosed-frontmatter\n',
    )
  })

  it('writes a hostile file name as one line of plain characters that decodes back to the name', async () => {
    const run = await runCli({...FIXTURE_WIKI, [HOSTILE_PATH]: UNCLOSED_PAGE}, EVENT_ENV)

    const match = /^wiki-query:warn:page-skipped path="([^"]*)" reason=unclosed-frontmatter\n$/u.exec(run.stderr)
    expect(match, run.stderr).not.toBeNull()
    const encoded = match?.[1] ?? ''
    expect(encoded).toMatch(/^[\w%./-]+$/u)
    expect(decodeURIComponent(encoded)).toBe(HOSTILE_PATH)
  })
})

describe('runWikiQuery: a stderr that cannot be written', () => {
  let originalCwd = ''
  let cwd = ''

  beforeEach(async () => {
    originalCwd = process.cwd()
    cwd = await mkdtemp(join(tmpdir(), 'wiki-query-stderr-'))
    process.chdir(cwd)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await rm(cwd, {recursive: true, force: true})
  })

  async function runWithBrokenStderr(files: Readonly<Record<string, string>>): Promise<{stdout: string[]}> {
    await writeWiki(cwd, files)
    const stdout: string[] = []
    await runWikiQuery(
      {
        ...EVENT_ENV,
        GITHUB_OUTPUT: join(cwd, 'github-output.txt'),
        WIKI_CONTEXT_HANDOFF_PATH: join(cwd, 'handoff.json'),
      },
      {
        stdout: text => stdout.push(text),
        stderr: () => {
          throw new Error('EPIPE')
        },
      },
    )
    return {stdout}
  }

  it('still writes the outputs, the handoff and stdout when a skipped-page warning cannot be written', async () => {
    const {stdout} = await runWithBrokenStderr({...FIXTURE_WIKI, [UNCLOSED_PATH]: UNCLOSED_PAGE})

    expect(stdout).toHaveLength(1)
    expect((JSON.parse(stdout[0] ?? '') as {selectedPaths: string[]}).selectedPaths).toContain(
      'knowledge/wiki/repos/fro-bot--agent.md',
    )
    expect(await readFile(join(cwd, 'github-output.txt'), 'utf8')).toContain('selected-paths=[')
    expect(
      (JSON.parse(await readFile(join(cwd, 'handoff.json'), 'utf8')) as {selectedPaths: string[]}).selectedPaths,
    ).toContain('knowledge/wiki/repos/fro-bot--agent.md')
  })

  it('still writes the empty outputs when the baseline-failed warning cannot be written', async () => {
    const {stdout} = await runWithBrokenStderr({'knowledge/index.md': '# Wiki Index\n', [UNCLOSED_PATH]: UNCLOSED_PAGE})

    expect(stdout).toEqual([EMPTY_STDOUT])
    expect(await readFile(join(cwd, 'github-output.txt'), 'utf8')).toContain('selected-paths=[]')
    expect(JSON.parse(await readFile(join(cwd, 'handoff.json'), 'utf8'))).toEqual({selectedPaths: []})
  })
})
