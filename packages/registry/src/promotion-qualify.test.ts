import {describe, expect, it} from 'vitest'
import {
  decideRun,
  InvalidPathEncodingError,
  isWeeklyRun,
  labelDecision,
  parseNameStatus,
  qualifyPromotion,
  runPromotionQualify,
  type PromotionGit,
  type Qualification,
} from './promotion-qualify.ts'

/** The `-z` form of `git diff --name-status -M`: each field ends with a NUL. */
function nameStatus(...records: readonly (readonly string[])[]): string {
  return records.map(record => record.map(field => `${field}\0`).join('')).join('')
}

interface FakeTrees {
  readonly diff: string
  readonly base?: Readonly<Record<string, string>>
  readonly head?: Readonly<Record<string, string>>
}

/** A fake git seam: `base` and `head` map a path to its tree entry id; a missing path is absent on that side. */
function fakeGit(trees: FakeTrees): PromotionGit & {readonly lookups: string[]} {
  const lookups: string[] = []
  return {
    lookups,
    diffNameStatus: async () => trees.diff,
    entryAt: async (side, path) => {
      lookups.push(`${side}:${path}`)
      return (side === 'base' ? trees.base : trees.head)?.[path] ?? null
    },
  }
}

/** Entries that differ on the two sides, so no path is dropped. */
function changed(...paths: readonly string[]): Pick<FakeTrees, 'base' | 'head'> {
  return {
    base: Object.fromEntries(paths.map(path => [path, '100644 blob aaa'])),
    head: Object.fromEntries(paths.map(path => [path, '100644 blob bbb'])),
  }
}

describe('parseNameStatus', () => {
  it('reads one path for each of A, M, D and T', () => {
    expect(parseNameStatus(nameStatus(['A', 'knowledge/a.md'], ['M', 'metadata/b.yaml']))).toEqual([
      'knowledge/a.md',
      'metadata/b.yaml',
    ])
    expect(parseNameStatus(nameStatus(['D', 'knowledge/c.md'], ['T', 'knowledge/d.md']))).toEqual([
      'knowledge/c.md',
      'knowledge/d.md',
    ])
  })

  it('reads both paths of a rename and of a copy', () => {
    expect(parseNameStatus(nameStatus(['R100', 'scripts/x.ts', 'knowledge/x.md']))).toEqual([
      'scripts/x.ts',
      'knowledge/x.md',
    ])
    expect(parseNameStatus(nameStatus(['C75', 'a/old.md', 'knowledge/new.md']))).toEqual([
      'a/old.md',
      'knowledge/new.md',
    ])
    expect(parseNameStatus(nameStatus(['R05', 'a', 'b']))).toEqual(['a', 'b'])
  })

  it('returns an empty list for an empty diff', () => {
    expect(parseNameStatus('')).toEqual([])
  })

  it.each([
    ['an unknown status', nameStatus(['X', 'knowledge/a.md'])],
    ['an unmerged status', nameStatus(['U', 'knowledge/a.md'])],
    ['a lowercase status', nameStatus(['m', 'knowledge/a.md'])],
    ['a status with a score on a one-path kind', nameStatus(['M100', 'knowledge/a.md'])],
    ['a rename without a score', nameStatus(['R', 'a', 'b'])],
    ['a rename with a non-numeric score', nameStatus(['R1x', 'a', 'b'])],
    ['a rename score with trailing text', nameStatus(['R100x', 'a', 'b'])],
    ['a rename score with leading text', nameStatus(['xR100', 'a', 'b'])],
    ['a rename with one path', nameStatus(['R100', 'a'])],
    ['a rename with an empty second path', nameStatus(['R100', 'a', ''])],
    ['a rename with an empty first path', nameStatus(['R100', '', 'b'])],
    ['a status with no path', 'M\0'],
    ['an empty path', nameStatus(['M', ''])],
    ['an empty status', nameStatus(['', 'knowledge/a.md'])],
    ['a record missing its trailing NUL', 'M\0knowledge/a.md'],
    ['a line-oriented diff', 'M\tknowledge/a.md\n'],
  ])('is malformed for %s', (_name, raw) => {
    expect(parseNameStatus(raw)).toBeNull()
  })

  it('is malformed when a later record is malformed', () => {
    expect(parseNameStatus(nameStatus(['M', 'knowledge/a.md'], ['Z', 'knowledge/b.md']))).toBeNull()
  })
})

describe('qualifyPromotion', () => {
  it('qualifies a diff that touches only knowledge/ and metadata/ (AE1)', async () => {
    const git = fakeGit({
      diff: nameStatus(['M', 'knowledge/wiki/a.md'], ['A', 'metadata/repos.yaml'], ['D', 'knowledge/old.md']),
      ...changed('knowledge/wiki/a.md', 'metadata/repos.yaml', 'knowledge/old.md'),
    })
    expect(await qualifyPromotion(git)).toEqual({state: 'qualifies'})
  })

  it('does not qualify when any path is outside the two prefixes (AE2)', async () => {
    const git = fakeGit({
      diff: nameStatus(['M', 'knowledge/a.md'], ['M', 'scripts/x.ts']),
      ...changed('knowledge/a.md', 'scripts/x.ts'),
    })
    expect(await qualifyPromotion(git)).toEqual({state: 'disqualified', reason: 'path-outside-allowlist'})
  })

  it('does not qualify a rename whose old path is outside the prefixes (AE3)', async () => {
    const git = fakeGit({
      diff: nameStatus(['R100', 'scripts/x.ts', 'knowledge/x.md']),
      base: {'scripts/x.ts': '100644 blob aaa'},
      head: {'knowledge/x.md': '100644 blob aaa'},
    })
    expect(await qualifyPromotion(git)).toEqual({state: 'disqualified', reason: 'path-outside-allowlist'})
  })

  it('does not qualify a rename whose new path is outside the prefixes', async () => {
    const git = fakeGit({
      diff: nameStatus(['R100', 'knowledge/x.md', 'scripts/x.ts']),
      base: {'knowledge/x.md': '100644 blob aaa'},
      head: {'scripts/x.ts': '100644 blob aaa'},
    })
    expect(await qualifyPromotion(git)).toEqual({state: 'disqualified', reason: 'path-outside-allowlist'})
  })

  it('qualifies a rename inside the prefixes', async () => {
    const git = fakeGit({
      diff: nameStatus(['R090', 'knowledge/a.md', 'metadata/a.md']),
      base: {'knowledge/a.md': '100644 blob aaa'},
      head: {'metadata/a.md': '100644 blob bbb'},
    })
    expect(await qualifyPromotion(git)).toEqual({state: 'qualifies'})
  })

  it.each(['knowledgebase/x.md', 'metadatas/x.yaml', 'knowledge', 'metadata', 'Knowledge/x.md', 'a/knowledge/x.md'])(
    'does not qualify the lookalike path %s',
    async path => {
      const git = fakeGit({diff: nameStatus(['M', path]), ...changed(path)})
      expect(await qualifyPromotion(git)).toEqual({state: 'disqualified', reason: 'path-outside-allowlist'})
    },
  )

  it('qualifies each prefix on its own', async () => {
    const knowledge = fakeGit({diff: nameStatus(['M', 'knowledge/x.md']), ...changed('knowledge/x.md')})
    const metadata = fakeGit({diff: nameStatus(['M', 'metadata/x.yaml']), ...changed('metadata/x.yaml')})
    expect(await qualifyPromotion(knowledge)).toEqual({state: 'qualifies'})
    expect(await qualifyPromotion(metadata)).toEqual({state: 'qualifies'})
  })

  it('reports an empty diff as empty', async () => {
    expect(await qualifyPromotion(fakeGit({diff: ''}))).toEqual({state: 'empty'})
  })

  it('drops a path whose entry at data already equals main, such as a squash-merged change', async () => {
    const git = fakeGit({
      diff: nameStatus(['M', 'scripts/x.ts'], ['M', 'knowledge/a.md']),
      base: {'scripts/x.ts': '100644 blob same', 'knowledge/a.md': '100644 blob aaa'},
      head: {'scripts/x.ts': '100644 blob same', 'knowledge/a.md': '100644 blob bbb'},
    })
    expect(await qualifyPromotion(git)).toEqual({state: 'qualifies'})
  })

  it('drops a path that is absent on both sides', async () => {
    const git = fakeGit({
      diff: nameStatus(['A', 'scripts/gone.ts'], ['M', 'knowledge/a.md']),
      ...changed('knowledge/a.md'),
    })
    expect(await qualifyPromotion(git)).toEqual({state: 'qualifies'})
  })

  it('reports empty when every path is dropped', async () => {
    const git = fakeGit({
      diff: nameStatus(['M', 'scripts/x.ts'], ['A', 'knowledge/y.md']),
      base: {'scripts/x.ts': '100644 blob same', 'knowledge/y.md': '100644 blob other'},
      head: {'scripts/x.ts': '100644 blob same', 'knowledge/y.md': '100644 blob other'},
    })
    expect(await qualifyPromotion(git)).toEqual({state: 'empty'})
  })

  it('keeps a path that is present on one side only', async () => {
    const addedOnData = fakeGit({
      diff: nameStatus(['A', 'scripts/new.ts']),
      head: {'scripts/new.ts': '100644 blob aaa'},
    })
    const deletedOnData = fakeGit({
      diff: nameStatus(['D', 'scripts/old.ts']),
      base: {'scripts/old.ts': '100644 blob aaa'},
    })
    expect(await qualifyPromotion(addedOnData)).toEqual({state: 'disqualified', reason: 'path-outside-allowlist'})
    expect(await qualifyPromotion(deletedOnData)).toEqual({state: 'disqualified', reason: 'path-outside-allowlist'})
  })

  it('keeps a path whose mode differs even when the blob is the same', async () => {
    const git = fakeGit({
      diff: nameStatus(['M', 'scripts/run.sh']),
      base: {'scripts/run.sh': '100644 blob same'},
      head: {'scripts/run.sh': '100755 blob same'},
    })
    expect(await qualifyPromotion(git)).toEqual({state: 'disqualified', reason: 'path-outside-allowlist'})
  })

  it('looks up each distinct path once on each side', async () => {
    const git = fakeGit({
      diff: nameStatus(['M', 'knowledge/a.md'], ['R100', 'knowledge/a.md', 'knowledge/b.md']),
      ...changed('knowledge/a.md', 'knowledge/b.md'),
    })
    await qualifyPromotion(git)
    expect([...git.lookups].sort()).toEqual([
      'base:knowledge/a.md',
      'base:knowledge/b.md',
      'head:knowledge/a.md',
      'head:knowledge/b.md',
    ])
  })

  it('does not look anything up when the diff is empty or malformed', async () => {
    const empty = fakeGit({diff: ''})
    const malformed = fakeGit({diff: 'garbage'})
    await qualifyPromotion(empty)
    await qualifyPromotion(malformed)
    expect(empty.lookups).toEqual([])
    expect(malformed.lookups).toEqual([])
  })

  it('does not qualify a malformed diff', async () => {
    const git = fakeGit({diff: nameStatus(['Q', 'knowledge/a.md'])})
    expect(await qualifyPromotion(git)).toEqual({state: 'disqualified', reason: 'malformed-diff'})
  })

  it('does not qualify a malformed diff even when its paths would qualify', async () => {
    const git = fakeGit({diff: 'M\tknowledge/a.md\n'})
    expect(await qualifyPromotion(git)).toEqual({state: 'disqualified', reason: 'malformed-diff'})
  })

  it('lets a git failure propagate', async () => {
    const git: PromotionGit = {
      diffNameStatus: async () => {
        throw new Error('boom')
      },
      entryAt: async () => null,
    }
    await expect(qualifyPromotion(git)).rejects.toThrow('boom')
  })
})

describe('qualifyPromotion: a path git could not decode as UTF-8 (fail closed)', () => {
  const invalid = () => {
    throw new InvalidPathEncodingError()
  }

  it('disqualifies when the diff cannot be decoded', async () => {
    const git: PromotionGit = {diffNameStatus: async () => invalid(), entryAt: async () => null}
    expect(await qualifyPromotion(git)).toEqual({state: 'disqualified', reason: 'invalid-path-encoding'})
  })

  it('disqualifies when a tree lookup cannot be decoded', async () => {
    const git: PromotionGit = {
      diffNameStatus: async () => nameStatus(['M', 'knowledge/a.md']),
      entryAt: async () => invalid(),
    }
    expect(await qualifyPromotion(git)).toEqual({state: 'disqualified', reason: 'invalid-path-encoding'})
  })

  it('still lets any other failure through, so the CLI fails with GIT_FAILED', async () => {
    const git: PromotionGit = {
      diffNameStatus: async () => {
        throw new Error('git exploded')
      },
      entryAt: async () => null,
    }
    await expect(qualifyPromotion(git)).rejects.toThrow('git exploded')
  })

  it('names the failure with a fixed message that carries no path', () => {
    expect(new InvalidPathEncodingError().message).toBe('invalid-path-encoding')
    expect(new InvalidPathEncodingError()).toBeInstanceOf(Error)
  })

  it('holds a daily run and runs the weekly one, like any other non-qualifying promotion', () => {
    const disqualified: Qualification = {state: 'disqualified', reason: 'invalid-path-encoding'}
    expect(decideRun(disqualified, false)).toEqual({run: false, reason: 'held-for-review'})
    expect(decideRun(disqualified, true)).toEqual({run: true, reason: 'weekly'})
  })
})

describe('isWeeklyRun', () => {
  const trigger = (eventName: string, schedule = '', refreshReview = '') => ({eventName, schedule, refreshReview})

  it('is true for the Sunday schedule', () => {
    expect(isWeeklyRun(trigger('schedule', '0 22 * * 0'))).toBe(true)
  })

  it('is false for the daily schedule', () => {
    expect(isWeeklyRun(trigger('schedule', '0 22 * * 1-6'))).toBe(false)
  })

  it('is false for a schedule with no cron text', () => {
    expect(isWeeklyRun(trigger('schedule', ''))).toBe(false)
  })

  it('is true for a dispatch that asks for a refresh', () => {
    expect(isWeeklyRun(trigger('workflow_dispatch', '', 'true'))).toBe(true)
  })

  it.each(['false', '', 'TRUE', '1', 'yes'])('is false for a dispatch with refresh-review %j', value => {
    expect(isWeeklyRun(trigger('workflow_dispatch', '', value))).toBe(false)
  })

  it('is false for a repository dispatch, whatever its refresh text', () => {
    expect(isWeeklyRun(trigger('repository_dispatch', '', 'true'))).toBe(false)
    expect(isWeeklyRun(trigger('repository_dispatch', '0 22 * * 0', 'true'))).toBe(false)
  })

  it('does not take a refresh input on a scheduled event', () => {
    expect(isWeeklyRun(trigger('schedule', '0 22 * * 1-6', 'true'))).toBe(false)
  })

  it('does not take the Sunday cron text from a dispatch', () => {
    expect(isWeeklyRun(trigger('workflow_dispatch', '0 22 * * 0', 'false'))).toBe(false)
  })
})

describe('decideRun', () => {
  const qualifies: Qualification = {state: 'qualifies'}
  const empty: Qualification = {state: 'empty'}
  const disqualified: Qualification = {state: 'disqualified', reason: 'path-outside-allowlist'}
  const malformed: Qualification = {state: 'disqualified', reason: 'malformed-diff'}

  it('runs a qualifying promotion on a daily run', () => {
    expect(decideRun(qualifies, false)).toEqual({run: true, reason: 'qualifies'})
  })

  it('runs a qualifying promotion on the weekly run', () => {
    expect(decideRun(qualifies, true)).toEqual({run: true, reason: 'qualifies'})
  })

  it('holds a non-qualifying promotion on a daily run (AE9)', () => {
    expect(decideRun(disqualified, false)).toEqual({run: false, reason: 'held-for-review'})
    expect(decideRun(malformed, false)).toEqual({run: false, reason: 'held-for-review'})
  })

  it('runs a non-qualifying promotion on the weekly run (AE2)', () => {
    expect(decideRun(disqualified, true)).toEqual({run: true, reason: 'weekly'})
    expect(decideRun(malformed, true)).toEqual({run: true, reason: 'weekly'})
  })

  it('reports no changes for an empty diff on a daily run', () => {
    expect(decideRun(empty, false)).toEqual({run: false, reason: 'no-changes'})
  })

  it('still runs the weekly run on an empty diff, so the merge-back keeps its weekly cadence', () => {
    expect(decideRun(empty, true)).toEqual({run: true, reason: 'weekly'})
  })
})

describe('labelDecision', () => {
  it('adds automerge and removes needs-review for a qualifying promotion', () => {
    expect(labelDecision(true)).toEqual({add: 'automerge', remove: 'needs-review'})
  })

  it('adds needs-review and removes automerge otherwise', () => {
    expect(labelDecision(false)).toEqual({add: 'needs-review', remove: 'automerge'})
  })
})

function harness(options: {readonly env: Readonly<Record<string, string | undefined>>; readonly trees: FakeTrees}) {
  const outputs: {path: string; content: string}[] = []
  const stderr: string[] = []
  const git = fakeGit(options.trees)
  const run = async () =>
    runPromotionQualify({
      env: {GITHUB_OUTPUT: '/out', GITHUB_STEP_SUMMARY: '/summary', ...options.env},
      git,
      stderr: text => stderr.push(text),
      append: (path, content) => outputs.push({path, content}),
    })
  return {run, outputs, stderr}
}

describe('runPromotionQualify', () => {
  const dailySchedule = {GITHUB_EVENT_NAME: 'schedule', PROMOTION_SCHEDULE: '0 22 * * 1-6'}

  it('writes run, reason and qualifies for a qualifying daily run', async () => {
    const {run, outputs, stderr} = harness({
      env: dailySchedule,
      trees: {diff: nameStatus(['M', 'knowledge/a.md']), ...changed('knowledge/a.md')},
    })
    expect(await run()).toBe(0)
    expect(outputs.find(entry => entry.path === '/out')?.content).toBe('run=true\nreason=qualifies\nqualifies=true\n')
    expect(stderr).toEqual([])
  })

  it('holds a non-qualifying daily run, says why in the summary and exits 0', async () => {
    const {run, outputs} = harness({
      env: dailySchedule,
      trees: {diff: nameStatus(['M', 'scripts/x.ts']), ...changed('scripts/x.ts')},
    })
    expect(await run()).toBe(0)
    expect(outputs.find(entry => entry.path === '/out')?.content).toBe(
      'run=false\nreason=held-for-review\nqualifies=false\n',
    )
    expect(outputs.find(entry => entry.path === '/summary')?.content).toBe(
      [
        '### Promotion held for review',
        '',
        'The `data` → `main` diff has a path outside `knowledge/` and `metadata/`, so the daily run leaves its head alone.',
        'The weekly run (Sunday 22:00 UTC) or a dispatch with `refresh-review` updates it. The unowned-changes alert also waits for the weekly run.',
        '',
      ].join('\n'),
    )
  })

  it('runs a non-qualifying promotion on the weekly schedule', async () => {
    const {run, outputs} = harness({
      env: {GITHUB_EVENT_NAME: 'schedule', PROMOTION_SCHEDULE: '0 22 * * 0'},
      trees: {diff: nameStatus(['M', 'scripts/x.ts']), ...changed('scripts/x.ts')},
    })
    expect(await run()).toBe(0)
    expect(outputs.find(entry => entry.path === '/out')?.content).toBe('run=true\nreason=weekly\nqualifies=false\n')
  })

  it('runs a non-qualifying promotion on a dispatch that asks for a refresh', async () => {
    const {run, outputs} = harness({
      env: {GITHUB_EVENT_NAME: 'workflow_dispatch', PROMOTION_REFRESH_REVIEW: 'true'},
      trees: {diff: nameStatus(['M', 'scripts/x.ts']), ...changed('scripts/x.ts')},
    })
    expect(await run()).toBe(0)
    expect(outputs.find(entry => entry.path === '/out')?.content).toBe('run=true\nreason=weekly\nqualifies=false\n')
  })

  it('reports no changes for an empty daily diff', async () => {
    const {run, outputs} = harness({env: dailySchedule, trees: {diff: ''}})
    expect(await run()).toBe(0)
    expect(outputs.find(entry => entry.path === '/out')?.content).toBe(
      'run=false\nreason=no-changes\nqualifies=false\n',
    )
    expect(outputs.find(entry => entry.path === '/summary')?.content).toBe(
      [
        '### Promotion skipped',
        '',
        'There are no changes to promote: nothing differs between `data` and `main` once content `main` already has is ignored.',
        '',
      ].join('\n'),
    )
  })

  it('treats a repository dispatch as a daily run', async () => {
    const {run, outputs} = harness({
      env: {GITHUB_EVENT_NAME: 'repository_dispatch'},
      trees: {diff: nameStatus(['M', 'scripts/x.ts']), ...changed('scripts/x.ts')},
    })
    expect(await run()).toBe(0)
    expect(outputs.find(entry => entry.path === '/out')?.content).toBe(
      'run=false\nreason=held-for-review\nqualifies=false\n',
    )
  })

  it('writes nothing to the summary for a run that proceeds', async () => {
    const {run, outputs} = harness({
      env: dailySchedule,
      trees: {diff: nameStatus(['M', 'knowledge/a.md']), ...changed('knowledge/a.md')},
    })
    await run()
    expect(outputs.some(entry => entry.path === '/summary')).toBe(false)
  })

  it('fails closed without an event name', async () => {
    const {run, outputs, stderr} = harness({env: {GITHUB_EVENT_NAME: undefined}, trees: {diff: ''}})
    expect(await run()).toBe(1)
    expect(stderr).toEqual(['promotion-qualify: GITHUB_EVENT_NAME is required\n'])
    expect(outputs).toEqual([])
  })

  it('fails closed with a fixed line when git fails, and leaks no message', async () => {
    const stderr: string[] = []
    const outputs: string[] = []
    const code = await runPromotionQualify({
      env: {GITHUB_EVENT_NAME: 'schedule', GITHUB_OUTPUT: '/out'},
      git: {
        diffNameStatus: async () => {
          throw new Error('fatal: secret-token in message')
        },
        entryAt: async () => null,
      },
      stderr: text => stderr.push(text),
      append: (_path, content) => outputs.push(content),
    })
    expect(code).toBe(1)
    expect(stderr).toEqual(['promotion-qualify: GIT_FAILED\n'])
    expect(outputs).toEqual([])
  })

  it('fails with a fixed line when GITHUB_OUTPUT is missing', async () => {
    const stderr: string[] = []
    const code = await runPromotionQualify({
      env: {GITHUB_EVENT_NAME: 'schedule'},
      git: fakeGit({diff: ''}),
      stderr: text => stderr.push(text),
      append: () => {},
    })
    expect(code).toBe(1)
    expect(stderr).toEqual(['promotion-qualify: OUTPUT_FAILED\n'])
  })
})
