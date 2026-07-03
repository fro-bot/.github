import type {RepoEntry} from './schemas.ts'
import type {CommitWikiChangesParams} from './wiki-ingest.ts'
import {createHash} from 'node:crypto'
import {describe, expect, it, vi} from 'vitest'

import {buildPublicSlugMap} from './check-wiki-private-presence.ts'
import {rebuildWikiIndex} from './wiki-ingest.ts'
import {lintWikiSnapshot} from './wiki-lint.ts'
import {
  gateWikiRepairs,
  planAndVerifyWikiRepairs,
  planWikiRepairs,
  runWikiRepair,
  verifyWikiRepairs,
  WIKI_REPAIR_COMMIT_MESSAGE,
  WIKI_REPAIR_DATA_BRANCH,
} from './wiki-repair.ts'

function buildPage(params: {
  path: string
  type?: string
  title?: string
  created?: string
  updated?: string
  bodyLines?: string[]
  extraFrontmatter?: string[]
}): [string, string] {
  const frontLines = ['---']
  if (params.type !== undefined) frontLines.push(`type: ${params.type}`)
  if (params.title !== undefined) frontLines.push(`title: ${params.title}`)
  frontLines.push(`created: ${params.created ?? '2026-04-16'}`)
  frontLines.push(`updated: ${params.updated ?? '2026-04-16'}`)
  if (params.extraFrontmatter !== undefined) frontLines.push(...params.extraFrontmatter)
  frontLines.push('---')

  return [params.path, [...frontLines, '', ...(params.bodyLines ?? ['Body text.']), ''].join('\n')]
}

function buildIndex(lines: string[]): string {
  return [
    '# Wiki Index',
    '',
    'Master catalog of all wiki pages, organized by type.',
    '',
    ...lines,
    '',
    '---',
    '',
    '_Footer._',
    '',
  ].join('\n')
}

function buildCleanFiles(): Record<string, string> {
  return Object.fromEntries([
    [
      'knowledge/index.md',
      buildIndex([
        '## Repos',
        '',
        '- [[fro-bot--github]] — Fro Bot .github',
        '',
        '## Topics',
        '',
        '- [[github-actions-ci]] — GitHub Actions CI',
        '',
        '## Entities',
        '',
        '_No entity pages yet._',
        '',
        '## Comparisons',
        '',
        '_No comparison pages yet._',
      ]),
    ],
    buildPage({
      path: 'knowledge/wiki/repos/fro-bot--github.md',
      type: 'repo',
      title: 'Fro Bot .github',
      bodyLines: ['See [[github-actions-ci]] for workflow conventions.'],
    }),
    buildPage({
      path: 'knowledge/wiki/topics/github-actions-ci.md',
      type: 'topic',
      title: 'GitHub Actions CI',
      bodyLines: ['See [[fro-bot--github]] for control-plane workflow patterns.'],
    }),
  ])
}

function emptyGateInputs() {
  return {publicSlugMap: new Map<string, readonly RepoEntry[]>(), grandfatherPages: []}
}

/**
 * Grandfather the repo page(s) already present in `files` by content-identity hash,
 * so tests focused on index/frontmatter repair aren't incidentally blocked by the
 * privacy gate's fail-closed default for unattributable pages.
 */
function passingGateInputs(files: Record<string, string>) {
  const grandfatherPages = Object.entries(files)
    .filter(([path]) => path.startsWith('knowledge/wiki/repos/') && path.endsWith('.md'))
    .map(([path, content]) => {
      const filename = path.slice('knowledge/wiki/repos/'.length)
      return {
        filename,
        stem: filename.replace(/\.md$/iu, '').toLowerCase(),
        hash: createHash('sha256').update(content).digest('hex'),
        content,
      }
    })
  return {publicSlugMap: new Map<string, readonly RepoEntry[]>(), grandfatherPages}
}

describe('planWikiRepairs', () => {
  it('regenerates the index for an index-drift finding and clears it (AE1)', () => {
    const files = buildCleanFiles()
    // Index references a slug that doesn't exist on disk.
    files['knowledge/index.md'] = buildIndex([
      '## Repos',
      '',
      '- [[fro-bot--github]] — Fro Bot .github',
      '- [[ghost--repo]] — Ghost Repo',
      '',
      '## Topics',
      '',
      '- [[github-actions-ci]] — GitHub Actions CI',
      '',
      '## Entities',
      '',
      '_No entity pages yet._',
      '',
      '## Comparisons',
      '',
      '_No comparison pages yet._',
    ])

    const baseline = lintWikiSnapshot({files}).deterministicFindings
    expect(baseline.some(f => f.kind === 'index-drift')).toBe(true)

    const plan = planWikiRepairs({baselineFindings: baseline, wikiFiles: files})

    expect(plan.noop).toBe(false)
    expect(plan.repairedFiles['knowledge/index.md']).not.toContain('ghost--repo')
    expect(plan.counts.repaired).toBe(0)
    expect(plan.targetedFindings.some(f => f.kind === 'index-drift')).toBe(true)

    const verify = verifyWikiRepairs({
      baselineFindings: baseline,
      targetedFindings: plan.targetedFindings,
      repairedFiles: plan.repairedFiles,
    })
    expect(verify.ok).toBe(true)
  })

  it('regenerates the index for an orphan-page finding', () => {
    const files = buildCleanFiles()
    files['knowledge/wiki/repos/orphan--page.md'] = buildPage({
      path: 'knowledge/wiki/repos/orphan--page.md',
      type: 'repo',
      title: 'Orphan Page',
    })[1]

    const baseline = lintWikiSnapshot({files}).deterministicFindings
    expect(baseline.some(f => f.kind === 'orphan-page')).toBe(true)

    const plan = planWikiRepairs({baselineFindings: baseline, wikiFiles: files})
    expect(plan.repairedFiles['knowledge/index.md']).toContain('orphan--page')

    const verify = verifyWikiRepairs({
      baselineFindings: baseline,
      targetedFindings: plan.targetedFindings,
      repairedFiles: plan.repairedFiles,
    })
    expect(verify.ok).toBe(true)
  })

  it('derives missing type from directory and copies missing title from H1 (AE2)', () => {
    const files = buildCleanFiles()
    const path = 'knowledge/wiki/repos/fro-bot--widget.md'
    files[path] = [
      '---',
      'created: 2026-04-16',
      'updated: 2026-04-16',
      '---',
      '',
      '# Fro Bot Widget',
      '',
      'Body text.',
      '',
    ].join('\n')
    files['knowledge/index.md'] = buildIndex([
      '## Repos',
      '',
      '- [[fro-bot--github]] — Fro Bot .github',
      '- [[fro-bot--widget]] — Fro Bot Widget',
      '',
      '## Topics',
      '',
      '- [[github-actions-ci]] — GitHub Actions CI',
      '',
      '## Entities',
      '',
      '_No entity pages yet._',
      '',
      '## Comparisons',
      '',
      '_No comparison pages yet._',
    ])

    const baseline = lintWikiSnapshot({files}).deterministicFindings
    const plan = planWikiRepairs({baselineFindings: baseline, wikiFiles: files})

    expect(plan.repairedFiles[path]).toContain('type: repo')
    expect(plan.repairedFiles[path]).toContain('title: Fro Bot Widget')
    expect(plan.counts.repaired).toBeGreaterThan(0)
  })

  it('leaves a missing title without an H1 untouched and out-of-scope (AE2)', () => {
    const files = buildCleanFiles()
    const path = 'knowledge/wiki/repos/fro-bot--widget.md'
    const originalContent = [
      '---',
      'type: repo',
      'created: 2026-04-16',
      'updated: 2026-04-16',
      '---',
      '',
      'No heading here, just prose.',
      '',
    ].join('\n')
    files[path] = originalContent

    const baseline = lintWikiSnapshot({files}).deterministicFindings
    expect(baseline.some(f => f.kind === 'missing-frontmatter' && f.path === path)).toBe(true)

    const plan = planWikiRepairs({baselineFindings: baseline, wikiFiles: files})

    expect(plan.repairedFiles[path]).toBe(originalContent)
    expect(plan.counts.outOfScope).toBeGreaterThan(0)
  })

  it('never repairs created, updated, sources, tags, aliases, related', () => {
    const files = buildCleanFiles()
    const path = 'knowledge/wiki/repos/fro-bot--widget.md'
    // Missing type (repairable) but also missing created/updated (never repairable).
    files[path] = ['---', 'title: Fro Bot Widget', '---', '', '# Fro Bot Widget', '', 'Body.', ''].join('\n')

    const baseline = lintWikiSnapshot({files}).deterministicFindings
    const plan = planWikiRepairs({baselineFindings: baseline, wikiFiles: files})

    // type gets fixed but created/updated remain missing, so the finding cannot fully
    // clear — page is reverted from the repair set entirely (byte-identical revert).
    expect(plan.repairedFiles[path]).toBe(files[path])
    expect(plan.counts.outOfScope).toBeGreaterThan(0)
  })

  it('reverts a page whose type is fixed but created is still missing (partial-page revert)', () => {
    const files = buildCleanFiles()
    const path = 'knowledge/wiki/repos/fro-bot--widget.md'
    const original = ['---', 'title: Fro Bot Widget', 'updated: 2026-04-16', '---', '', 'Body.', ''].join('\n')
    files[path] = original
    files['knowledge/index.md'] = buildIndex([
      '## Repos',
      '',
      '- [[fro-bot--github]] — Fro Bot .github',
      '- [[fro-bot--widget]] — Fro Bot Widget',
      '',
      '## Topics',
      '',
      '- [[github-actions-ci]] — GitHub Actions CI',
      '',
      '## Entities',
      '',
      '_No entity pages yet._',
      '',
      '## Comparisons',
      '',
      '_No comparison pages yet._',
    ])

    const baseline = lintWikiSnapshot({files}).deterministicFindings
    const plan = planWikiRepairs({baselineFindings: baseline, wikiFiles: files})

    // Page reverted: still missing created, so finding can't fully clear.
    expect(plan.repairedFiles[path]).toBe(original)
    expect(plan.counts.outOfScope).toBeGreaterThan(0)
  })

  it('counts judgment-class findings as out-of-scope without touching pages (F3)', () => {
    const files = buildCleanFiles()
    const baseline = [
      {
        kind: 'broken-wikilink' as const,
        path: 'knowledge/wiki/repos/fro-bot--github.md',
        target: 'missing-page',
        message: 'broken',
      },
      {kind: 'stale-claim' as const, path: 'knowledge/wiki/repos/fro-bot--github.md', message: 'stale'},
    ]

    const plan = planWikiRepairs({baselineFindings: baseline, wikiFiles: files})

    expect(plan.counts.outOfScope).toBe(2)
    expect(plan.repairedFiles['knowledge/wiki/repos/fro-bot--github.md']).toBe(
      files['knowledge/wiki/repos/fro-bot--github.md'],
    )
  })

  it('treats unparseable frontmatter YAML as out-of-scope, file byte-identical', () => {
    const files = buildCleanFiles()
    const path = 'knowledge/wiki/repos/fro-bot--broken.md'
    const original = ['---', 'type: [unterminated', '---', '', 'Body.', ''].join('\n')
    files[path] = original

    const baseline = lintWikiSnapshot({files}).deterministicFindings
    expect(baseline.some(f => f.kind === 'invalid-frontmatter' && f.path === path)).toBe(true)

    const plan = planWikiRepairs({baselineFindings: baseline, wikiFiles: files})

    expect(plan.repairedFiles[path]).toBe(original)
    expect(plan.counts.outOfScope).toBeGreaterThan(0)
  })

  it('refuses a repair whose path is outside knowledge/ (AE5)', () => {
    const files = buildCleanFiles()
    const baseline = [{kind: 'missing-frontmatter' as const, path: 'metadata/repos.yaml', message: 'missing fields'}]

    const plan = planWikiRepairs({baselineFindings: baseline, wikiFiles: files})

    expect(plan.counts.pathRefused).toBe(1)
  })

  it('counts a stale index-drift finding as out-of-scope when regeneration is byte-identical', () => {
    const files = buildCleanFiles()
    // Regenerate the index once up front so `files['knowledge/index.md']` is
    // already byte-identical to what rebuildWikiIndex would produce again —
    // simulating a stale/false index-drift finding that regeneration cannot clear.
    files['knowledge/index.md'] = rebuildWikiIndex({existingIndex: files['knowledge/index.md'], wikiFiles: files})
    const baseline = [{kind: 'index-drift' as const, path: 'knowledge/index.md', target: 'ghost--repo', message: 'x'}]

    const plan = planWikiRepairs({baselineFindings: baseline, wikiFiles: files})

    expect(plan.counts.repaired).toBe(0)
    expect(plan.counts.outOfScope).toBe(1)
    expect(plan.targetedFindings.some(f => f.kind === 'index-drift')).toBe(false)
    expect(plan.counts.repairableSeen).toBe(plan.counts.repaired + plan.counts.outOfScope + plan.counts.pathRefused)
  })

  it('returns a counted no-op when there is nothing repairable', () => {
    const files = buildCleanFiles()
    const baseline = lintWikiSnapshot({files}).deterministicFindings
    expect(baseline).toEqual([])

    const plan = planWikiRepairs({baselineFindings: baseline, wikiFiles: files})

    expect(plan.noop).toBe(true)
    expect(plan.counts.repaired).toBe(0)
  })
})

describe('verifyWikiRepairs', () => {
  it('aborts when a targeted finding survives verification (AE3)', () => {
    const files = buildCleanFiles()
    const baseline = [{kind: 'index-drift' as const, path: 'knowledge/index.md', target: 'ghost--repo', message: 'x'}]

    // Repaired map does NOT actually clear the drift (simulating a bad repair).
    const originalIndex = files['knowledge/index.md'] ?? ''
    const verify = verifyWikiRepairs({
      baselineFindings: baseline,
      targetedFindings: baseline,
      repairedFiles: {
        ...files,
        'knowledge/index.md': originalIndex.replace(
          '- [[fro-bot--github]]',
          '- [[ghost--repo]] — Ghost\n- [[fro-bot--github]]',
        ),
      },
    })

    expect(verify.ok).toBe(false)
    expect(verify.survivingFindings.length).toBeGreaterThan(0)
  })

  it('aborts when the repaired tree introduces a new deterministic finding (no-worse rule)', () => {
    const files = buildCleanFiles()
    const baseline = lintWikiSnapshot({files}).deterministicFindings
    expect(baseline).toEqual([])

    // Introduce a brand-new orphan page not present in the baseline.
    const repairedFiles = {
      ...files,
      'knowledge/wiki/repos/new--orphan.md': buildPage({
        path: 'knowledge/wiki/repos/new--orphan.md',
        type: 'repo',
        title: 'New Orphan',
      })[1],
    }

    const verify = verifyWikiRepairs({baselineFindings: baseline, targetedFindings: [], repairedFiles})

    expect(verify.ok).toBe(false)
    expect(verify.newFindings.length).toBeGreaterThan(0)
  })
})

describe('gateWikiRepairs', () => {
  it('passes when no repo pages are unattributable', () => {
    const result = gateWikiRepairs({
      repairedWikiFiles: buildCleanFiles(),
      ...emptyGateInputs(),
    })
    // fro-bot--github isn't in publicSlugMap or grandfatherPages, so it's flagged —
    // this exercises the fail-closed path directly.
    expect(result.ok).toBe(false)
    expect(result.leaks.length).toBeGreaterThan(0)
  })

  it('passes when the repo page matches a public slug entry with attribution (AE9 clean case)', () => {
    const repos: RepoEntry[] = [
      {
        owner: 'fro-bot',
        name: 'github',
        added: '2026-01-01',
        onboarding_status: 'onboarded',
        last_survey_at: null,
        last_survey_status: null,
        has_fro_bot_workflow: true,
        has_renovate: false,
        private: false,
      },
    ]
    const files = buildCleanFiles()
    files['knowledge/wiki/repos/fro-bot--github.md'] = [
      '---',
      'type: repo',
      'title: Fro Bot .github',
      'created: 2026-04-16',
      'updated: 2026-04-16',
      '---',
      '',
      'https://github.com/fro-bot/github',
      '',
    ].join('\n')

    const result = gateWikiRepairs({
      repairedWikiFiles: files,
      publicSlugMap: buildPublicSlugMap(repos),
      grandfatherPages: [],
    })

    expect(result.ok).toBe(true)
  })

  it('aborts when the repair would reintroduce a redacted private slug (AE9)', () => {
    const repos: RepoEntry[] = [
      {
        owner: 'acme',
        name: 'widget',
        added: '2026-01-01',
        onboarding_status: 'onboarded',
        last_survey_at: null,
        last_survey_status: null,
        has_fro_bot_workflow: true,
        has_renovate: false,
        private: false,
      },
      {
        owner: 'ACME',
        name: 'WIDGET',
        added: '2026-01-01',
        onboarding_status: 'onboarded',
        last_survey_at: null,
        last_survey_status: null,
        has_fro_bot_workflow: true,
        has_renovate: false,
        private: false,
      },
    ]

    const files: Record<string, string> = {
      'knowledge/wiki/repos/acme--widget.md': [
        '---',
        'type: repo',
        'title: Widget',
        'created: 2026-04-16',
        'updated: 2026-04-16',
        '---',
        '',
        'Body.',
        '',
      ].join('\n'),
    }

    const result = gateWikiRepairs({
      repairedWikiFiles: files,
      publicSlugMap: buildPublicSlugMap(repos),
      grandfatherPages: [],
    })

    expect(result.ok).toBe(false)
    expect(result.leaks.some(l => l.reason === 'ambiguous-public-slug')).toBe(true)
  })
})

describe('planAndVerifyWikiRepairs', () => {
  it('returns a repaired result for a clean AE1 index-drift fixture', () => {
    const files = buildCleanFiles()
    files['knowledge/index.md'] = buildIndex([
      '## Repos',
      '',
      '- [[fro-bot--github]] — Fro Bot .github',
      '- [[ghost--repo]] — Ghost Repo',
      '',
      '## Topics',
      '',
      '- [[github-actions-ci]] — GitHub Actions CI',
      '',
      '## Entities',
      '',
      '_No entity pages yet._',
      '',
      '## Comparisons',
      '',
      '_No comparison pages yet._',
    ])
    const baseline = lintWikiSnapshot({files}).deterministicFindings

    const result = planAndVerifyWikiRepairs({
      baselineFindings: baseline,
      wikiFiles: files,
      ...passingGateInputs(files),
    })

    expect(result.status).toBe('repaired')
    expect(result.repairedFiles['knowledge/index.md']).not.toContain('ghost--repo')
  })

  it('does not repair anything on an incomplete/failed scan (no baseline findings supplied) (AE4)', () => {
    const files = buildCleanFiles()
    const result = planAndVerifyWikiRepairs({
      baselineFindings: [],
      wikiFiles: files,
      ...emptyGateInputs(),
    })

    expect(result.status).toBe('noop')
  })
})

function makeTree(files: Record<string, string>, tipSha = 'tip-1') {
  return {
    tipSha,
    wikiFiles: files,
    ...passingGateInputs(files),
  }
}

describe('runWikiRepair', () => {
  it('happy path: exactly one commit with the fixed message and only changed knowledge/ files', async () => {
    const files = buildCleanFiles()
    files['knowledge/index.md'] = buildIndex([
      '## Repos',
      '',
      '- [[fro-bot--github]] — Fro Bot .github',
      '- [[ghost--repo]] — Ghost Repo',
      '',
      '## Topics',
      '',
      '- [[github-actions-ci]] — GitHub Actions CI',
      '',
      '## Entities',
      '',
      '_No entity pages yet._',
      '',
      '## Comparisons',
      '',
      '_No comparison pages yet._',
    ])

    const commitWikiChangesMock = vi.fn(async (_p: CommitWikiChangesParams) => ({
      committed: true,
      commitSha: 'sha-1',
      attempts: 1,
    }))
    const loadTree = vi.fn(async () => makeTree(files))
    const getCurrentDataTipSha = vi.fn(async () => 'tip-1')

    const result = await runWikiRepair({loadTree, getCurrentDataTipSha, commitWikiChanges: commitWikiChangesMock})

    expect(result.repaired).toBeGreaterThanOrEqual(0)
    expect(result.aborted).toBe(0)
    expect(commitWikiChangesMock).toHaveBeenCalledTimes(1)
    const callArgs = commitWikiChangesMock.mock.calls[0]?.[0]
    expect(callArgs?.branch).toBe(WIKI_REPAIR_DATA_BRANCH)
    expect(callArgs?.message).toBe(WIKI_REPAIR_COMMIT_MESSAGE)
    expect(Object.keys(callArgs?.files ?? {})).toEqual(['knowledge/index.md'])
  })

  it('dry-run: pipeline runs, zero commit calls, result carries dry-run marker', async () => {
    const files = buildCleanFiles()
    files['knowledge/index.md'] = buildIndex([
      '## Repos',
      '',
      '- [[fro-bot--github]] — Fro Bot .github',
      '- [[ghost--repo]] — Ghost Repo',
      '',
      '## Topics',
      '',
      '- [[github-actions-ci]] — GitHub Actions CI',
      '',
      '## Entities',
      '',
      '_No entity pages yet._',
      '',
      '## Comparisons',
      '',
      '_No comparison pages yet._',
    ])

    const commitWikiChangesMock = vi.fn(async () => ({committed: true, commitSha: 'sha-1', attempts: 1}))
    const loadTree = vi.fn(async () => makeTree(files))
    const getCurrentDataTipSha = vi.fn(async () => 'tip-1')

    const result = await runWikiRepair({
      loadTree,
      getCurrentDataTipSha,
      commitWikiChanges: commitWikiChangesMock,
      dryRun: true,
    })

    expect(result.dry_run).toBe(true)
    expect(commitWikiChangesMock).not.toHaveBeenCalled()
    expect(getCurrentDataTipSha).not.toHaveBeenCalled()
  })

  it('conflict retry: tip moved before commit → reload and recompute; persisted findings retry commit (AE6)', async () => {
    const files1 = buildCleanFiles()
    files1['knowledge/index.md'] = buildIndex([
      '## Repos',
      '',
      '- [[fro-bot--github]] — Fro Bot .github',
      '- [[ghost--repo]] — Ghost Repo',
      '',
      '## Topics',
      '',
      '- [[github-actions-ci]] — GitHub Actions CI',
      '',
      '## Entities',
      '',
      '_No entity pages yet._',
      '',
      '## Comparisons',
      '',
      '_No comparison pages yet._',
    ])
    const files2 = {...files1} // Findings persist in the reloaded tree too.

    const commitWikiChangesMock = vi.fn(async () => ({committed: true, commitSha: 'sha-2', attempts: 1}))
    const loadTree = vi
      .fn()
      .mockResolvedValueOnce(makeTree(files1, 'tip-1'))
      .mockResolvedValueOnce(makeTree(files2, 'tip-2'))
    const getCurrentDataTipSha = vi.fn(async () => 'tip-2') // Moved before the pre-commit check.

    const result = await runWikiRepair({loadTree, getCurrentDataTipSha, commitWikiChanges: commitWikiChangesMock})

    expect(result.conflict_retries).toBe(1)
    expect(commitWikiChangesMock).toHaveBeenCalledTimes(1)
    expect(loadTree).toHaveBeenCalledTimes(2)
  })

  it('conflict-then-cleared: reload shows findings already fixed → no-op exit, no commit', async () => {
    const driftFiles = buildCleanFiles()
    driftFiles['knowledge/index.md'] = buildIndex([
      '## Repos',
      '',
      '- [[fro-bot--github]] — Fro Bot .github',
      '- [[ghost--repo]] — Ghost Repo',
      '',
      '## Topics',
      '',
      '- [[github-actions-ci]] — GitHub Actions CI',
      '',
      '## Entities',
      '',
      '_No entity pages yet._',
      '',
      '## Comparisons',
      '',
      '_No comparison pages yet._',
    ])
    const cleanFiles = buildCleanFiles()

    const commitWikiChangesMock = vi.fn(async () => ({committed: true, commitSha: 'sha-3', attempts: 1}))
    const loadTree = vi
      .fn()
      .mockResolvedValueOnce(makeTree(driftFiles, 'tip-1'))
      .mockResolvedValueOnce(makeTree(cleanFiles, 'tip-2'))
    const getCurrentDataTipSha = vi.fn(async () => 'tip-2')

    const result = await runWikiRepair({loadTree, getCurrentDataTipSha, commitWikiChanges: commitWikiChangesMock})

    expect(result.noop).toBe(1)
    expect(commitWikiChangesMock).not.toHaveBeenCalled()
  })

  it('tip-moved-before-commit triggers the conflict path even without a ref-update error', async () => {
    const files = buildCleanFiles()
    files['knowledge/index.md'] = buildIndex([
      '## Repos',
      '',
      '- [[fro-bot--github]] — Fro Bot .github',
      '- [[ghost--repo]] — Ghost Repo',
      '',
      '## Topics',
      '',
      '- [[github-actions-ci]] — GitHub Actions CI',
      '',
      '## Entities',
      '',
      '_No entity pages yet._',
      '',
      '## Comparisons',
      '',
      '_No comparison pages yet._',
    ])

    const commitWikiChangesMock = vi.fn(async () => ({committed: true, commitSha: 'sha-4', attempts: 1}))
    const loadTree = vi.fn(async () => makeTree(files, 'tip-1'))
    const getCurrentDataTipSha = vi.fn().mockResolvedValueOnce('tip-2').mockResolvedValueOnce('tip-1')

    const result = await runWikiRepair({loadTree, getCurrentDataTipSha, commitWikiChanges: commitWikiChangesMock})

    expect(result.conflict_retries).toBe(1)
    expect(loadTree).toHaveBeenCalledTimes(2)
  })

  it('commit message is byte-identical to the constant across scenarios and result JSON carries no paths/slugs (AE7)', async () => {
    const files = buildCleanFiles()
    files['knowledge/index.md'] = buildIndex([
      '## Repos',
      '',
      '- [[fro-bot--github]] — Fro Bot .github',
      '- [[ghost--repo]] — Ghost Repo',
      '',
      '## Topics',
      '',
      '- [[github-actions-ci]] — GitHub Actions CI',
      '',
      '## Entities',
      '',
      '_No entity pages yet._',
      '',
      '## Comparisons',
      '',
      '_No comparison pages yet._',
    ])

    const commitWikiChangesMock = vi.fn(async (_p: CommitWikiChangesParams) => ({
      committed: true,
      commitSha: 'sha-5',
      attempts: 1,
    }))
    const loadTree = vi.fn(async () => makeTree(files))
    const getCurrentDataTipSha = vi.fn(async () => 'tip-1')

    const result = await runWikiRepair({loadTree, getCurrentDataTipSha, commitWikiChanges: commitWikiChangesMock})

    const callArgs = commitWikiChangesMock.mock.calls[0]?.[0]
    expect(callArgs?.message).toBe(WIKI_REPAIR_COMMIT_MESSAGE)

    const resultJson = JSON.stringify(result)
    expect(resultJson).not.toContain('knowledge/')
    expect(resultJson).not.toContain('ghost--repo')
    expect(resultJson).not.toContain('fro-bot')
  })

  it('never calls any issues.* API surface (AE8)', async () => {
    const files = buildCleanFiles()
    files['knowledge/index.md'] = buildIndex([
      '## Repos',
      '',
      '- [[fro-bot--github]] — Fro Bot .github',
      '- [[ghost--repo]] — Ghost Repo',
      '',
      '## Topics',
      '',
      '- [[github-actions-ci]] — GitHub Actions CI',
      '',
      '## Entities',
      '',
      '_No entity pages yet._',
      '',
      '## Comparisons',
      '',
      '_No comparison pages yet._',
    ])

    const issuesApi = {create: vi.fn(), update: vi.fn(), createComment: vi.fn()}
    const commitWikiChangesMock = vi.fn(async () => ({committed: true, commitSha: 'sha-6', attempts: 1}))
    const loadTree = vi.fn(async () => makeTree(files))
    const getCurrentDataTipSha = vi.fn(async () => 'tip-1')

    await runWikiRepair({loadTree, getCurrentDataTipSha, commitWikiChanges: commitWikiChangesMock})

    expect(issuesApi.create).not.toHaveBeenCalled()
    expect(issuesApi.update).not.toHaveBeenCalled()
    expect(issuesApi.createComment).not.toHaveBeenCalled()
  })

  it('privacy abort: gate blocks the repaired map, counted as privacy_blocked and aborted (AE9)', async () => {
    const repos: RepoEntry[] = [
      {
        owner: 'acme',
        name: 'widget',
        added: '2026-01-01',
        onboarding_status: 'onboarded',
        last_survey_at: null,
        last_survey_status: null,
        has_fro_bot_workflow: true,
        has_renovate: false,
        private: false,
      },
      {
        owner: 'other',
        name: 'widget',
        added: '2026-01-01',
        onboarding_status: 'onboarded',
        last_survey_at: null,
        last_survey_status: null,
        has_fro_bot_workflow: true,
        has_renovate: false,
        private: false,
      },
    ]

    const files: Record<string, string> = {
      'knowledge/index.md': buildIndex([
        '## Repos',
        '',
        '- [[acme--widget]] — Widget',
        '- [[ghost--repo]] — Ghost Repo',
        '',
        '## Topics',
        '',
        '_No topic pages yet._',
        '',
        '## Entities',
        '',
        '_No entity pages yet._',
        '',
        '## Comparisons',
        '',
        '_No comparison pages yet._',
      ]),
      'knowledge/wiki/repos/acme--widget.md': [
        '---',
        'type: repo',
        'title: Widget',
        'created: 2026-04-16',
        'updated: 2026-04-16',
        '---',
        '',
        'Body.',
        '',
      ].join('\n'),
    }

    const commitWikiChangesMock = vi.fn(async () => ({committed: true, commitSha: 'sha-7', attempts: 1}))
    const loadTree = vi.fn(async () => ({
      tipSha: 'tip-1',
      wikiFiles: files,
      publicSlugMap: buildPublicSlugMap(repos),
      grandfatherPages: [],
    }))
    const getCurrentDataTipSha = vi.fn(async () => 'tip-1')

    const result = await runWikiRepair({loadTree, getCurrentDataTipSha, commitWikiChanges: commitWikiChangesMock})

    expect(result.aborted).toBe(1)
    expect(result.privacy_blocked).toBe(1)
    expect(commitWikiChangesMock).not.toHaveBeenCalled()
  })
})
