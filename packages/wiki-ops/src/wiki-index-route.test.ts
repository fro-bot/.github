/**
 * The wiki index behind the stderr router, as the two daily-pass steps run it: the router flags are written
 * here, the command is the real `scripts/wiki-index.ts`, and the unwrapped run is the reference. Wrapping must
 * change the job summary and nothing else a later step reads.
 */
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnEntrypoint, type SpawnEntrypointResult} from '@fro-bot/test-kit/spawn-entrypoint'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

const ROUTER = fileURLToPath(new URL('../../../scripts/route-stderr.ts', import.meta.url))
const WIKI_INDEX = fileURLToPath(new URL('../../../scripts/wiki-index.ts', import.meta.url))
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu

const ROUTER_FLAGS = [
  '--route',
  'wiki-index:warn:page-skipped =Wiki pages skipped',
  '--route',
  'wiki-index:warn:index-=Wiki index unavailable',
  '--summary',
  'filtered',
]

const GOOD_PAGES: Readonly<Record<string, string>> = {
  'knowledge/index.md': '# Wiki Index\n',
  'knowledge/wiki/repos/fro-bot--agent.md':
    '---\ntype: repo\ntitle: Fro Bot Agent\ntags: [agent]\n---\n\n# Agent\n\nFro Bot Agent uses Vitest.\n',
  'knowledge/wiki/topics/vitest.md': '---\ntype: topic\ntitle: Vitest\ntags: [testing]\n---\n\nVitest is the runner.\n',
}
const UNCLOSED_PAGE = '---\ntype: topic\ntitle: Bad\ntags: [vitest]\n\nBody vitest.\n'
const BAD_YAML_PAGE = '---\ntype: topic\ntitle: Bad\ntags: [vitest unterminated\n---\n\nBody vitest.\n'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wiki-index-route-'))
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

function observe(result: SpawnEntrypointResult): Observed {
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    githubOutput: result.githubOutput.replaceAll(UUID_PATTERN, '<delimiter>'),
  }
}

/** Runs the index bare and behind the router, on the same checkout. `summary` is what the router appended. */
async function runBoth(files: Readonly<Record<string, string>>, summaryPath?: string): Promise<Both> {
  const cwd = await checkout('checkout', files)
  const summary = summaryPath ?? join(root, 'summary.md')
  await writeFile(join(root, 'summary.md'), '')

  const plain = await spawnEntrypoint({entrypoint: WIKI_INDEX, cwd})
  const wrapped = await spawnEntrypoint({
    entrypoint: ROUTER,
    cwd,
    argv: [...ROUTER_FLAGS, 'bun', WIKI_INDEX],
    env: {GITHUB_STEP_SUMMARY: summary},
  })

  return {
    plain: observe(plain),
    wrapped: observe(wrapped),
    summary: await readFile(join(root, 'summary.md'), 'utf8'),
  }
}

describe('wrapped and unwrapped wiki index', () => {
  it.each([
    ['no bad page', GOOD_PAGES],
    ['one unclosed page', {...GOOD_PAGES, 'knowledge/wiki/topics/bad.md': UNCLOSED_PAGE}],
    ['one invalid YAML page', {...GOOD_PAGES, 'knowledge/wiki/topics/bad.md': BAD_YAML_PAGE}],
    ['every page bad', {'knowledge/index.md': '# Wiki Index\n', 'knowledge/wiki/topics/bad.md': UNCLOSED_PAGE}],
    ['no wiki at all', {'knowledge/index.md': '# Wiki Index\n'}],
  ])('%s: stdout, stderr, GITHUB_OUTPUT and the exit code are identical', async (_name, files) => {
    const {plain, wrapped} = await runBoth(files)

    expect(plain.exitCode).toBe(0)
    expect(wrapped).toStrictEqual(plain)
  })

  it('writes the status line to stdout and nothing to the summary when no page is bad', async () => {
    const {plain, summary} = await runBoth(GOOD_PAGES)

    expect(plain.stdout).toMatch(/^wiki-index: listed=2 held=2 sentences=kept bytes=\d+\n$/u)
    expect(plain.stderr).toBe('')
    expect(plain.githubOutput).toMatch(
      /^index<<<delimiter>\nWiki index: 2 of 2 pages listed\.\n[\s\S]*\n<delimiter>\n$/u,
    )
    expect(summary).toBe('')
  })

  it('lifts one skipped page into the summary: its path and the fixed reason', async () => {
    const {plain, summary} = await runBoth({...GOOD_PAGES, 'knowledge/wiki/topics/bad.md': UNCLOSED_PAGE})

    expect(plain.stderr).toBe(
      'wiki-index:warn:page-skipped path="knowledge/wiki/topics/bad.md" reason=unclosed-frontmatter\n',
    )
    expect(summary).toBe('### Wiki pages skipped\n- path="knowledge/wiki/topics/bad.md" reason=unclosed-frontmatter\n')
  })

  it('lifts the unavailable signal into the summary and prints the unavailable line when no page is readable', async () => {
    const {plain, summary} = await runBoth({
      'knowledge/index.md': '# Wiki Index\n',
      'knowledge/wiki/topics/bad.md': BAD_YAML_PAGE,
    })

    expect(plain.stdout).toBe('wiki-index: unavailable\n')
    expect(plain.githubOutput).toBe('index=\n')
    expect(summary).toBe(
      '### Wiki pages skipped\n- path="knowledge/wiki/topics/bad.md" reason=invalid-frontmatter\n### Wiki index unavailable\n- unavailable\n',
    )
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
