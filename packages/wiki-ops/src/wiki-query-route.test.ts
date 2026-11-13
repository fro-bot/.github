/**
 * The baseline wiki query behind the stderr router, as the three `Query wiki context` steps run it: the router
 * flags are read from the real workflow, the query is the real `scripts/wiki-query.ts`, and the unwrapped run is
 * the reference. Wrapping must change the job summary and nothing else a later step reads.
 */
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnEntrypoint, type SpawnEntrypointResult} from '@fro-bot/test-kit/spawn-entrypoint'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {loadRouterSteps} from '../fixtures/route-stderr-workflow-steps.ts'

const ROUTER = fileURLToPath(new URL('../../../scripts/route-stderr.ts', import.meta.url))
const WIKI_QUERY = fileURLToPath(new URL('../../../scripts/wiki-query.ts', import.meta.url))
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu

const ROUTER_FLAGS = (() => {
  const flags = loadRouterSteps()
    .filter(step => step.key === 'wiki-query')
    .map(step => step.routerFlags)
  if (flags.length !== 3) throw new Error('expected three wiki-query steps')
  return flags
})()

const GOOD_PAGES: Readonly<Record<string, string>> = {
  'knowledge/index.md': '# Wiki Index\n',
  'knowledge/wiki/repos/fro-bot--agent.md':
    '---\ntype: repo\ntitle: Fro Bot Agent\ntags: [agent, vitest]\n---\n\nFro Bot Agent uses Vitest.\n',
  'knowledge/wiki/topics/vitest.md':
    '---\ntype: topic\ntitle: Vitest\ntags: [testing]\n---\n\nVitest is the test runner.\n',
}
const UNCLOSED_PAGE = '---\ntype: topic\ntitle: Bad\ntags: [vitest]\n\nBody vitest.\n'
const BAD_YAML_PAGE = '---\ntype: topic\ntitle: Bad\ntags: [vitest unterminated\n---\n\nBody vitest.\n'

const EVENT_ENV = {
  WIKI_QUERY_EVENT_NAME: 'pull_request',
  WIKI_QUERY_OWNER: 'fro-bot',
  WIKI_QUERY_REPO: 'agent',
  WIKI_QUERY_TITLE: 'vitest coverage',
  WIKI_QUERY_BODY: '',
}

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wiki-query-route-'))
})

afterEach(async () => {
  await rm(root, {recursive: true, force: true})
})

interface Observed {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  /** `$GITHUB_OUTPUT` with the random heredoc delimiter replaced. */
  readonly githubOutput: string
  readonly handoff: string
}

interface Both {
  readonly plain: Observed
  readonly wrapped: Observed
  readonly summary: string
}

async function checkout(name: string, files: Readonly<Record<string, string>>): Promise<string> {
  const cwd = join(root, name)
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(cwd, path)), {recursive: true})
    await writeFile(join(cwd, path), content)
  }
  await mkdir(cwd, {recursive: true})
  return cwd
}

async function observe(result: SpawnEntrypointResult, handoffPath: string): Promise<Observed> {
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    githubOutput: result.githubOutput.replaceAll(UUID_PATTERN, '<delimiter>'),
    handoff: await readFile(handoffPath, 'utf8').catch(() => ''),
  }
}

/** Runs the query bare and behind the router of the first step, on the same checkout. `summary` is what the router appended. */
async function runBoth(files: Readonly<Record<string, string>>, summaryPath?: string): Promise<Both> {
  const cwd = await checkout('checkout', files)
  const plainHandoff = join(root, 'plain-handoff.json')
  const wrappedHandoff = join(root, 'wrapped-handoff.json')
  const summary = summaryPath ?? join(root, 'summary.md')
  await writeFile(join(root, 'summary.md'), '')

  const plain = await spawnEntrypoint({
    entrypoint: WIKI_QUERY,
    cwd,
    env: {...EVENT_ENV, WIKI_CONTEXT_HANDOFF_PATH: plainHandoff},
  })
  const wrapped = await spawnEntrypoint({
    entrypoint: ROUTER,
    cwd,
    argv: [...(ROUTER_FLAGS[0] ?? []), 'bun', WIKI_QUERY],
    env: {...EVENT_ENV, WIKI_CONTEXT_HANDOFF_PATH: wrappedHandoff, GITHUB_STEP_SUMMARY: summary},
  })

  return {
    plain: await observe(plain, plainHandoff),
    wrapped: await observe(wrapped, wrappedHandoff),
    summary: await readFile(join(root, 'summary.md'), 'utf8'),
  }
}

describe('the router flags of the three steps', () => {
  it('are the same in all three', () => {
    expect(ROUTER_FLAGS[1]).toStrictEqual(ROUTER_FLAGS[0])
    expect(ROUTER_FLAGS[2]).toStrictEqual(ROUTER_FLAGS[0])
  })
})

describe('wrapped and unwrapped baseline wiki query', () => {
  it.each([
    ['no bad page', GOOD_PAGES, 0],
    ['one unclosed page', {...GOOD_PAGES, 'knowledge/wiki/topics/bad.md': UNCLOSED_PAGE}, 0],
    ['one invalid YAML page', {...GOOD_PAGES, 'knowledge/wiki/topics/bad.md': BAD_YAML_PAGE}, 0],
    ['every page bad', {'knowledge/index.md': '# Wiki Index\n', 'knowledge/wiki/topics/bad.md': UNCLOSED_PAGE}, 0],
  ])('%s: stdout, stderr, GITHUB_OUTPUT, the handoff file and the exit code are identical', async (_name, files) => {
    const {plain, wrapped} = await runBoth(files)

    expect(plain.exitCode).toBe(0)
    expect(wrapped).toStrictEqual(plain)
  })

  it('writes nothing to the summary when no page is bad', async () => {
    const {plain, summary} = await runBoth(GOOD_PAGES)

    expect(plain.stderr).toBe('')
    expect(summary).toBe('')
  })

  it('lifts one skipped page into the summary: its path and the fixed reason', async () => {
    const {plain, summary} = await runBoth({...GOOD_PAGES, 'knowledge/wiki/topics/bad.md': UNCLOSED_PAGE})

    expect(plain.stderr).toBe(
      'wiki-query:warn:page-skipped path="knowledge/wiki/topics/bad.md" reason=unclosed-frontmatter\n',
    )
    expect(summary).toBe('### Wiki pages skipped\n- path="knowledge/wiki/topics/bad.md" reason=unclosed-frontmatter\n')
  })

  it('lifts the empty-context signal into the summary when no page is readable', async () => {
    const {summary} = await runBoth({
      'knowledge/index.md': '# Wiki Index\n',
      'knowledge/wiki/topics/bad.md': BAD_YAML_PAGE,
    })

    expect(summary).toBe('### Wiki context unavailable\n- query-failed\n')
  })

  it('keeps a hostile file name to plain characters on one line of the summary', async () => {
    const name = 'x [a](http:evil) <img src=x onerror=1> "q" `b` _i_ *s* ~ | é.md'
    const {summary} = await runBoth({...GOOD_PAGES, [`knowledge/wiki/topics/${name}`]: BAD_YAML_PAGE})

    expect(summary).toMatch(/^### Wiki pages skipped\n- path="[\w%./-]+" reason=invalid-frontmatter\n$/u)
    expect(decodeURIComponent(/path="([^"]*)"/u.exec(summary)?.[1] ?? '')).toBe(`knowledge/wiki/topics/${name}`)
  })

  it('exits 0 with every output written when the summary cannot be written', async () => {
    const files = {...GOOD_PAGES, 'knowledge/wiki/topics/bad.md': UNCLOSED_PAGE}
    const {plain, wrapped} = await runBoth(files, root)

    expect(wrapped.exitCode).toBe(0)
    expect({...wrapped, stderr: ''}).toStrictEqual({...plain, stderr: ''})
    expect(wrapped.stderr).toBe(`${plain.stderr}route-stderr: summary-write-failed\n`)
  })
})
