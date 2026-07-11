import {spawnSync} from 'node:child_process'
import {chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'

import {describe, expect, it, vi} from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const wikiQueryModulePromise: Promise<{
  assembleWikiContext: typeof import('./wiki-query.js').assembleWikiContext
  writeSelectedPathsHandoff: typeof import('./wiki-query.js').writeSelectedPathsHandoff
}> = import(`./wiki-query${'.js'}`)
const {assembleWikiContext, writeSelectedPathsHandoff} = await wikiQueryModulePromise

describe('assembleWikiContext', () => {
  it('prioritizes the repo page for repo-local pull request context', () => {
    // #given repo, topic, and entity pages related to a pull request event
    const result = assembleWikiContext({
      files: {
        'knowledge/index.md': [
          '# Wiki Index',
          '',
          '## Repos',
          '',
          '- [[fro-bot--agent]] — Fro Bot Agent',
          '',
          '## Topics',
          '',
          '- [[vitest]] — Vitest',
          '',
          '## Entities',
          '',
          '- [[octokit]] — Octokit',
          '',
          '## Comparisons',
          '',
          '_No comparison pages yet. Pages will appear here as alternatives are analyzed._',
          '',
        ].join('\n'),
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
        'knowledge/wiki/entities/octokit.md': [
          '---',
          'type: entity',
          'title: Octokit',
          'created: 2026-04-16',
          'updated: 2026-04-16',
          'tags: [github]',
          '---',
          '',
          'Octokit powers GitHub API access.',
          '',
        ].join('\n'),
      },
      event: {
        eventName: 'pull_request',
        owner: 'fro-bot',
        repo: 'agent',
        title: 'feat: add atomic wiki ingest',
        body: 'This changes Vitest coverage and Octokit git data API usage.',
      },
    })

    // #when the wiki query assembles prompt context
    // #then the repo page is ranked first and the excerpt stays within budget
    expect(result.selectedPaths[0]).toBe('knowledge/wiki/repos/fro-bot--agent.md')
    expect(result.excerpt).toContain('Fro Bot Agent uses Vitest and Octokit')
    expect(result.byteLength).toBeLessThanOrEqual(5 * 1024)
  })

  it('enforces the hard 5kb context cap', () => {
    const largeBody = 'signal '.repeat(2000)

    // #given oversized wiki pages that would overflow the prompt budget
    const result = assembleWikiContext({
      files: {
        'knowledge/index.md': '# Wiki Index\n\n## Repos\n\n- [[fro-bot--agent]] — Fro Bot Agent\n',
        'knowledge/wiki/repos/fro-bot--agent.md': `---\ntype: repo\ntitle: Fro Bot Agent\ncreated: 2026-04-16\nupdated: 2026-04-16\n---\n\n${largeBody}\n`,
        'knowledge/wiki/topics/vitest.md': `---\ntype: topic\ntitle: Vitest\ncreated: 2026-04-16\nupdated: 2026-04-16\n---\n\n${largeBody}\n`,
      },
      event: {
        eventName: 'issues',
        owner: 'fro-bot',
        repo: 'agent',
        title: 'Issue about Vitest',
        body: largeBody,
      },
    })

    // #when the context builder truncates and packs excerpts
    // #then the final payload never exceeds 5kb
    expect(result.byteLength).toBeLessThanOrEqual(5 * 1024)
  })

  it('uses topical matches when repo context is absent', () => {
    // #given a schedule event with no repo-local target but a strong topical match
    const result = assembleWikiContext({
      files: {
        'knowledge/index.md': '# Wiki Index\n',
        'knowledge/wiki/topics/github-actions-ci.md': [
          '---',
          'type: topic',
          'title: GitHub Actions CI',
          'created: 2026-04-16',
          'updated: 2026-04-16',
          'tags: [ci, workflows, actions]',
          '---',
          '',
          'GitHub Actions CI should pin actions and validate workflows.',
          '',
        ].join('\n'),
      },
      event: {
        eventName: 'schedule',
        title: 'Daily org oversight',
        body: 'Audit CI workflows and GitHub Actions usage across repos.',
      },
    })

    // #when the query scores wiki relevance without a repo slug
    // #then it still returns the strongest topical page
    expect(result.selectedPaths).toContain('knowledge/wiki/topics/github-actions-ci.md')
    expect(result.excerpt).toContain('GitHub Actions CI should pin actions')
  })

  it('returns an empty excerpt when no pages match the event context', () => {
    // #given wiki pages that share no signals with the incoming event
    const result = assembleWikiContext({
      files: {
        'knowledge/index.md': '# Wiki Index\n',
        'knowledge/wiki/topics/rust-embedded.md': [
          '---',
          'type: topic',
          'title: Rust Embedded',
          'created: 2026-04-16',
          'updated: 2026-04-16',
          'tags: [firmware, embedded]',
          '---',
          '',
          'Rust Embedded focuses on firmware tooling and device constraints.',
          '',
        ].join('\n'),
      },
      event: {
        eventName: 'issues',
        owner: 'fro-bot',
        repo: '.github',
        title: 'Quartz zephyr tuning',
        body: 'Nebula glyph orbits lumen vectors.',
      },
    })

    // #when wiki relevance scoring finds zero matches
    // #then the assembled context is intentionally empty
    expect(result.excerpt).toBe('')
    expect(result.selectedPaths).toEqual([])
    expect(result.byteLength).toBe(0)
  })

  it('truncates multi-byte utf8 content without emitting invalid text', () => {
    const emojiHeavyBody = 'Deploy notes 😀😀😀 remain valid after truncation.'.repeat(200)

    // #given a matching page whose excerpt must be truncated through emoji bytes
    const result = assembleWikiContext({
      files: {
        'knowledge/index.md': '# Wiki Index\n',
        'knowledge/wiki/repos/fro-bot--agent.md': `---\ntype: repo\ntitle: Fro Bot Agent\ncreated: 2026-04-16\nupdated: 2026-04-16\n---\n\n${emojiHeavyBody}\n`,
      },
      event: {
        eventName: 'pull_request',
        owner: 'fro-bot',
        repo: 'agent',
        title: 'Agent deploy notes',
        body: 'Deploy notes mention emoji handling.',
      },
      maxBytes: 160,
    })

    // #when utf8 truncation slices the excerpt to the byte budget
    // #then it keeps valid text and appends the overflow marker
    expect(result.excerpt).toContain('…')
    expect(result.byteLength).toBeLessThanOrEqual(160)
    expect(result.excerpt).not.toContain('�')
  })

  it('surfaces malformed wiki frontmatter instead of silently including a fallback page', () => {
    // #given a wiki corpus containing invalid YAML frontmatter
    const files = {
      'knowledge/wiki/topics/broken.md': '---\ntags: [unterminated\ntitle: Broken\n---\n\nBody.\n',
    }

    // #when assembling baseline wiki context
    // #then the pure core throws so the CLI shell can fail-soft to empty context
    expect(() => assembleWikiContext({files, event: {eventName: 'workflow_dispatch', title: 'broken'}})).toThrow(
      'Invalid wiki frontmatter in knowledge/wiki/topics/broken.md',
    )
  })
})

describe('writeSelectedPathsHandoff', () => {
  it('writes selected paths as a deterministic JSON array under the handoff path', async () => {
    // #given a runner-temp directory and a set of selected wiki paths
    const dir = await mkdtemp(join(tmpdir(), 'wiki-handoff-'))
    const handoffPath = join(dir, 'wiki-context-handoff-1-1.json')

    try {
      // #when the handoff writer runs
      await writeSelectedPathsHandoff(handoffPath, [
        'knowledge/wiki/repos/fro-bot--agent.md',
        'knowledge/wiki/topics/vitest.md',
      ])

      // #then the file contains only the selected paths as a JSON array
      const contents = await readFile(handoffPath, 'utf8')
      expect(JSON.parse(contents)).toEqual({
        selectedPaths: ['knowledge/wiki/repos/fro-bot--agent.md', 'knowledge/wiki/topics/vitest.md'],
      })
    } finally {
      await rm(dir, {recursive: true, force: true})
    }
  })

  it('writes an empty array, not a missing or malformed file, when there are no selected paths', async () => {
    // #given a runner-temp directory and zero selected paths
    const dir = await mkdtemp(join(tmpdir(), 'wiki-handoff-'))
    const handoffPath = join(dir, 'wiki-context-handoff-2-1.json')

    try {
      // #when the handoff writer runs with an empty selection
      await writeSelectedPathsHandoff(handoffPath, [])

      // #then the file exists with an explicit empty selectedPaths array
      const contents = await readFile(handoffPath, 'utf8')
      expect(JSON.parse(contents)).toEqual({selectedPaths: []})
    } finally {
      await rm(dir, {recursive: true, force: true})
    }
  })

  it('sets owner-only permissions on the handoff file when the platform supports it', async () => {
    // #given a runner-temp directory
    const dir = await mkdtemp(join(tmpdir(), 'wiki-handoff-'))
    const handoffPath = join(dir, 'wiki-context-handoff-3-1.json')

    try {
      // #when the handoff writer runs
      await writeSelectedPathsHandoff(handoffPath, ['knowledge/wiki/topics/vitest.md'])

      // #then the file mode is restricted to owner read/write only
      const stats = await stat(handoffPath)

      expect(stats.mode & 0o777).toBe(0o600)
    } finally {
      await rm(dir, {recursive: true, force: true})
    }
  })

  it('fails soft when the handoff path is unwritable, without throwing', async () => {
    // #given a handoff path inside a directory that does not exist and cannot be created safely
    const unwritablePath = join('/nonexistent-root-that-should-not-exist', 'handoff.json')
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    try {
      // #when the handoff writer runs against an unwritable path
      // #then it resolves without throwing (fail-soft), leaving baseline output unaffected
      await expect(
        writeSelectedPathsHandoff(unwritablePath, ['knowledge/wiki/topics/vitest.md']),
      ).resolves.toBeUndefined()
    } finally {
      stderrSpy.mockRestore()
    }
  })

  it('emits a closed-vocabulary stderr warning on write failure without leaking the raw path', async () => {
    // #given a handoff path that will fail to write, and a stderr spy
    const unwritablePath = join('/nonexistent-root-that-should-not-exist', 'handoff.json')
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    try {
      // #when the handoff writer fails
      await writeSelectedPathsHandoff(unwritablePath, ['knowledge/wiki/topics/vitest.md'])

      // #then a closed-vocabulary status token is written to stderr, with no raw path or error text
      const written = stderrSpy.mock.calls.map(call => String(call[0])).join('')
      expect(written).toContain('wiki-query:warn:handoff-write-failed')
      expect(written).not.toContain('nonexistent-root-that-should-not-exist')
    } finally {
      stderrSpy.mockRestore()
    }
  })
})

describe('wiki-query CLI shell behavior', () => {
  it('skips an unreadable wiki page while preserving readable baseline context', async () => {
    // #given a repo-shaped working directory with one readable matching page and one unreadable page
    const dir = await mkdtemp(join(tmpdir(), 'wiki-query-cli-partial-'))
    const wikiRoot = join(dir, 'knowledge/wiki')
    const badPath = join(wikiRoot, 'topics/unreadable.md')

    try {
      await mkdir(join(wikiRoot, 'repos'), {recursive: true})
      await mkdir(join(wikiRoot, 'topics'), {recursive: true})
      await mkdir(join(wikiRoot, 'entities'), {recursive: true})
      await mkdir(join(wikiRoot, 'comparisons'), {recursive: true})
      await writeFile(join(dir, 'knowledge/index.md'), '# Wiki Index\n')
      await writeFile(
        join(wikiRoot, 'repos/fro-bot--agent.md'),
        '---\ntype: repo\ntitle: Fro Bot Agent\ntags: [agent]\n---\n\nAgent context remains readable.\n',
      )
      await writeFile(badPath, '---\ntype: topic\ntitle: Broken\n---\n\nUnreadable.\n')
      await chmod(badPath, 0o000)

      // #when the real CLI script runs
      const result = spawnSync('node', [join(import.meta.dirname, 'wiki-query.ts')], {
        cwd: dir,
        encoding: 'utf8',
        env: {
          ...process.env,
          WIKI_QUERY_EVENT_NAME: 'workflow_dispatch',
          WIKI_QUERY_TITLE: 'agent context',
        },
      })

      // #then the unreadable file is skipped and the readable context survives
      expect(result.status).toBe(0)
      expect(result.stderr).not.toContain('wiki-query:warn:baseline-query-failed')
      const parsed = JSON.parse(result.stdout) as {excerpt: string; selectedPaths: string[]}
      expect(parsed.selectedPaths).toContain('knowledge/wiki/repos/fro-bot--agent.md')
      expect(parsed.excerpt).toContain('Agent context remains readable')
    } finally {
      await chmod(badPath, 0o600).catch(() => undefined)
      await rm(dir, {recursive: true, force: true})
    }
  })

  it('catches baseline query failure and still writes empty outputs plus handoff', async () => {
    // #given a temporary repo-shaped working directory with malformed wiki frontmatter
    const dir = await mkdtemp(join(tmpdir(), 'wiki-query-cli-'))
    const wikiDir = join(dir, 'knowledge/wiki/topics')
    const githubOutput = join(dir, 'github-output.txt')
    const handoffPath = join(dir, 'handoff.json')

    try {
      await mkdir(wikiDir, {recursive: true})
      await writeFile(join(wikiDir, 'broken.md'), '---\ntags: [unterminated\ntitle: Broken\n---\n\nBody.\n')

      // #when the real CLI script runs from that working directory
      const result = spawnSync('node', [join(import.meta.dirname, 'wiki-query.ts')], {
        cwd: dir,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_OUTPUT: githubOutput,
          WIKI_CONTEXT_HANDOFF_PATH: handoffPath,
          WIKI_QUERY_EVENT_NAME: 'workflow_dispatch',
          WIKI_QUERY_TITLE: 'broken',
        },
      })

      // #then the shell layer fails soft: success exit, closed warning, empty stdout JSON,
      // GitHub outputs, and an explicit empty selected-path handoff
      expect(result.status).toBe(0)
      expect(result.stderr).toContain('wiki-query:warn:baseline-query-failed')
      expect(JSON.parse(result.stdout)).toEqual({excerpt: '', selectedPaths: [], byteLength: 0})
      expect(await readFile(githubOutput, 'utf8')).toContain('selected-paths=[]')
      expect(JSON.parse(await readFile(handoffPath, 'utf8'))).toEqual({selectedPaths: []})
    } finally {
      await rm(dir, {recursive: true, force: true})
    }
  })
})
