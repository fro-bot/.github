import type {GitDataFake} from '@fro-bot/test-kit/git-data-fake'
import type {RepoEntry} from './schemas.ts'
import type {CommitWikiChangesParams, OctokitClient} from './wiki-ingest.ts'
import {createHash} from 'node:crypto'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import process from 'node:process'
import {fileURLToPath} from 'node:url'
import {createGitDataFake} from '@fro-bot/test-kit/git-data-fake'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {buildPublicSlugMap} from './check-wiki-private-presence.ts'
import {commitWikiChanges, rebuildWikiIndex, WikiIngestError} from './wiki-ingest.ts'
import {lintWikiSnapshot} from './wiki-lint.ts'
import {
  createWikiRepairTreeLoader,
  exitCodeFor,
  gateWikiRepairs,
  loadWikiRepairTreeAtHead,
  planAndVerifyWikiRepairs,
  planWikiRepairs,
  recordWikiRepairResult,
  runAndRecordWikiRepair,
  runWikiRepair,
  verifyWikiRepairs,
  WIKI_REPAIR_COMMIT_MESSAGE,
  WIKI_REPAIR_DATA_BRANCH,
  type WikiRepairResultCounts,
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
    expect(plan.counts.repaired).toBe(1)
    expect(plan.counts.outOfScope).toBe(0)
    expect(plan.counts.repairableSeen).toBe(plan.counts.repaired + plan.counts.outOfScope + plan.counts.pathRefused)
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
    expect(plan.counts.repaired).toBe(1)
    expect(plan.counts.repairableSeen).toBe(plan.counts.repaired + plan.counts.outOfScope + plan.counts.pathRefused)

    const verify = verifyWikiRepairs({
      baselineFindings: baseline,
      targetedFindings: plan.targetedFindings,
      repairedFiles: plan.repairedFiles,
    })
    expect(verify.ok).toBe(true)
  })

  it('counts both index-drift and orphan-page findings as repaired when one regeneration clears both', () => {
    const files = buildCleanFiles()
    // Index references a slug that doesn't exist on disk (index-drift)...
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
    // ...and a page on disk that the index doesn't reference (orphan-page).
    files['knowledge/wiki/repos/orphan--page.md'] = buildPage({
      path: 'knowledge/wiki/repos/orphan--page.md',
      type: 'repo',
      title: 'Orphan Page',
    })[1]

    const baseline = lintWikiSnapshot({files}).deterministicFindings
    expect(baseline.some(f => f.kind === 'index-drift')).toBe(true)
    expect(baseline.some(f => f.kind === 'orphan-page')).toBe(true)

    const plan = planWikiRepairs({baselineFindings: baseline, wikiFiles: files})

    expect(plan.counts.repaired).toBe(2)
    expect(plan.counts.outOfScope).toBe(0)
    expect(plan.counts.repairableSeen).toBe(plan.counts.repaired + plan.counts.outOfScope + plan.counts.pathRefused)
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

  it('counts broken markdown links as judgment-class findings without repairing them', () => {
    const files = buildCleanFiles()
    const baseline = [
      {
        kind: 'broken-markdown-link' as const,
        path: 'knowledge/wiki/repos/fro-bot--github.md',
        target: 'missing.md',
        message: 'broken markdown link',
      },
    ]

    const plan = planWikiRepairs({baselineFindings: baseline, wikiFiles: files})

    expect(plan.counts.outOfScope).toBe(1)
    expect(plan.counts.repairableSeen).toBe(0)
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
    expect(callArgs?.baseCommitSha).toBe('tip-1')
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

  describe('persistent conflict exhausts the attempts', () => {
    const driftedFiles = (): Record<string, string> => {
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
      return files
    }

    it.each([1, 2, 3, 5])(
      'a tip that always moves aborts after maxRetries=%s attempts: conflict_retries == maxRetries, loadTree ran one more time',
      async maxRetries => {
        const files = driftedFiles()
        const commitWikiChangesMock = vi.fn(async () => ({committed: true, commitSha: 'never', attempts: 1}))
        const loadTree = vi.fn(async () => makeTree(files, 'tip-1'))
        const getCurrentDataTipSha = vi.fn(async () => 'tip-2')

        const result = await runWikiRepair({
          loadTree,
          getCurrentDataTipSha,
          commitWikiChanges: commitWikiChangesMock,
          maxRetries,
        })

        expect(result).toMatchObject({aborted: 1, repaired: 0, noop: 0, conflict_retries: maxRetries})
        expect(loadTree).toHaveBeenCalledTimes(maxRetries + 1)
        expect(getCurrentDataTipSha).toHaveBeenCalledTimes(maxRetries)
        expect(commitWikiChangesMock).not.toHaveBeenCalled()
      },
    )

    it('uses 3 attempts by default', async () => {
      const files = driftedFiles()
      const loadTree = vi.fn(async () => makeTree(files, 'tip-1'))
      const result = await runWikiRepair({
        loadTree,
        getCurrentDataTipSha: async () => 'tip-2',
        commitWikiChanges: vi.fn(async () => ({committed: true, commitSha: 'never', attempts: 1})),
      })
      expect(result).toMatchObject({aborted: 1, conflict_retries: 3})
      expect(loadTree).toHaveBeenCalledTimes(4)
    })

    it('a commit that keeps losing the ref race (CONFLICT_EXHAUSTED) aborts the same way', async () => {
      const files = driftedFiles()
      const commitWikiChangesMock = vi.fn(async () => {
        throw new WikiIngestError({code: 'CONFLICT_EXHAUSTED', message: 'lost', remediation: 'retry'})
      })
      const loadTree = vi.fn(async () => makeTree(files, 'tip-1'))

      const result = await runWikiRepair({
        loadTree,
        getCurrentDataTipSha: async () => 'tip-1',
        commitWikiChanges: commitWikiChangesMock,
        maxRetries: 2,
      })

      expect(result).toMatchObject({aborted: 1, conflict_retries: 2})
      expect(commitWikiChangesMock).toHaveBeenCalledTimes(2)
      expect(loadTree).toHaveBeenCalledTimes(3)
    })

    it('runs no attempt for maxRetries below 1, loading the tree once and aborting', async () => {
      const loadTree = vi.fn(async () => makeTree(driftedFiles(), 'tip-1'))
      const getCurrentDataTipSha = vi.fn(async () => 'tip-1')
      const result = await runWikiRepair({
        loadTree,
        getCurrentDataTipSha,
        commitWikiChanges: vi.fn(async () => ({committed: true, commitSha: 'never', attempts: 1})),
        maxRetries: 0,
      })
      expect(result).toMatchObject({aborted: 1, conflict_retries: 0})
      expect(loadTree).toHaveBeenCalledTimes(1)
      expect(getCurrentDataTipSha).not.toHaveBeenCalled()
    })
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

function driftedFiles(): Record<string, string> {
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
  return files
}

describe('runWikiRepair with the real writer (the base is the tip the tree was loaded from)', () => {
  interface Entry {
    path: string
    mode: string
    type: string
    sha: string
  }

  const entry = (path: string, sha: string): Entry => ({path, mode: '100644', type: 'blob', sha})

  /** `tip-1` is the tip the tree was loaded from; the first write-time read already sees `tip-2`. */
  function world(tip2: Entry[]) {
    const trees: Record<string, Entry[]> = {
      'tree-tip-1': [entry('knowledge/index.md', 'index-v1'), entry('scripts/x.ts', 'x-v1')],
      'tree-tip-2': tip2,
    }
    const createCommit = vi.fn(async (_args: {parents: string[]}) => ({data: {sha: 'repair-commit'}}))
    const createBlob = vi.fn(async () => ({data: {sha: 'blob'}}))
    const updateRef = vi.fn(async () => ({data: {}}))
    const octokit = {
      rest: {
        repos: {getBranch: async () => ({data: {name: 'data', commit: {sha: 'tip-2'}}})},
        git: {
          getRef: async () => ({data: {object: {sha: 'tip-2'}}}),
          getCommit: async (args: {commit_sha: string}) => ({
            data: {sha: args.commit_sha, tree: {sha: `tree-${args.commit_sha}`}},
          }),
          getTree: async (args: {tree_sha: string}) => ({data: {truncated: false, tree: trees[args.tree_sha] ?? []}}),
          createBlob,
          createTree: async () => ({data: {sha: 'tree-after'}}),
          createCommit,
          updateRef,
        },
      },
    }
    const loadTree = vi
      .fn()
      .mockResolvedValueOnce(makeTree(driftedFiles(), 'tip-1'))
      .mockResolvedValueOnce(makeTree(driftedFiles(), 'tip-2'))
    // The pre-commit tip check passes against the loaded tip, then the data branch has moved.
    const getCurrentDataTipSha = vi.fn().mockResolvedValueOnce('tip-1').mockResolvedValue('tip-2')
    const run = async () =>
      runWikiRepair({
        loadTree,
        getCurrentDataTipSha,
        commitWikiChanges: async params =>
          commitWikiChanges({...params, owner: 'fro-bot', repo: '.github', octokit: octokit as never}),
      })
    return {run, createCommit, createBlob, updateRef, loadTree}
  }

  it('fails closed and reloads when a commit landed on the repaired path since the load', async () => {
    // #given data moved past the loaded tip and rewrote the index the repair is about to replace
    const w = world([entry('knowledge/index.md', 'index-v2'), entry('scripts/x.ts', 'x-v1')])

    // #when the repair runs
    const result = await w.run()

    // #then the first attempt wrote nothing; the retry reloaded the new tip and then wrote once
    expect(result.conflict_retries).toBe(1)
    expect(w.loadTree).toHaveBeenCalledTimes(2)
    expect(w.createCommit).toHaveBeenCalledTimes(1)
    expect(w.createCommit.mock.calls[0]?.[0].parents).toEqual(['tip-2'])
    expect(w.updateRef).toHaveBeenCalledTimes(1)
  })

  it('writes once, with no retry, when the commit since the load touched only an unowned path', async () => {
    const w = world([entry('knowledge/index.md', 'index-v1'), entry('scripts/x.ts', 'x-v2')])

    const result = await w.run()

    expect(result.conflict_retries).toBe(0)
    expect(w.loadTree).toHaveBeenCalledTimes(1)
    expect(w.createCommit).toHaveBeenCalledTimes(1)
    expect(w.createCommit.mock.calls[0]?.[0].parents).toEqual(['tip-2'])
  })
})

describe('runWikiRepair against a data branch that moves under it (head reload)', () => {
  const REPOS_YAML = 'version: 1\nrepos: []\n'
  const SURVEY_PAGE = 'knowledge/wiki/topics/survey-added.md'
  let fake: GitDataFake

  const octokit = (): OctokitClient => fake.client as unknown as OctokitClient
  const writes = (): string[] =>
    fake.calls.map(call => call.method).filter(method => ['createBlob', 'createCommit', 'updateRef'].includes(method))

  /** The job's restore is the seed commit; every later read has to come from the head. */
  function seed(): {restoredFiles: Record<string, string>; tipSha: string} {
    const restoredFiles = driftedFiles()
    fake = createGitDataFake({branch: 'data', files: {...restoredFiles, 'metadata/repos.yaml': REPOS_YAML}})
    return {restoredFiles, tipSha: fake.head()}
  }

  function repairParams(restored: {restoredFiles: Record<string, string>; tipSha: string}) {
    const grandfatherPages = passingGateInputs(restored.restoredFiles).grandfatherPages
    const loadFromCheckout = vi.fn(async () => ({
      tipSha: restored.tipSha,
      wikiFiles: restored.restoredFiles,
      publicSlugMap: new Map<string, readonly RepoEntry[]>(),
      grandfatherPages,
    }))
    return {
      loadTree: createWikiRepairTreeLoader({
        loadFromCheckout,
        loadAtHead: async pages =>
          loadWikiRepairTreeAtHead({octokit: octokit(), owner: 'fro-bot', repo: '.github', grandfatherPages: pages}),
      }),
      getCurrentDataTipSha: async () => fake.head(),
      commitWikiChanges: async (params: CommitWikiChangesParams) =>
        commitWikiChanges({
          ...params,
          owner: 'fro-bot',
          repo: '.github',
          octokit: octokit(),
          bootstrapDataBranch: async () => ({created: false, ref: 'refs/heads/data', sha: fake.head()}),
        }),
    }
  }

  const run = async (restored: {restoredFiles: Record<string, string>; tipSha: string}) =>
    runWikiRepair(repairParams(restored))

  it('re-reads the head after a survey commit, keeps the survey change and lands on the second attempt (AE10)', async () => {
    // #given a survey commits a page to data after the repair's restore
    const restored = seed()
    const [path, content] = buildPage({
      path: SURVEY_PAGE,
      type: 'topic',
      title: 'Survey Added',
      bodyLines: ['See [[github-actions-ci]].'],
    })
    fake.advance({[path]: content})

    // #when the repair runs
    const result = await run(restored)

    // #then it retried once from the new head and committed there: the survey page is still on data and
    // listed in the index the repair rebuilt, and the stale row is gone
    // the stale row (index-drift) and the survey page missing from the index (orphan-page)
    expect(result).toMatchObject({repaired: 2, aborted: 0, conflict_retries: 1})
    const data = fake.files()
    expect(data[SURVEY_PAGE]).toBe(content)
    expect(data['knowledge/index.md']).toContain('[[survey-added]]')
    expect(data['knowledge/index.md']).not.toContain('[[ghost--repo]]')
    expect(writes().filter(method => method === 'updateRef')).toHaveLength(1)
  })

  it('lands on the first attempt without reading the head when nothing moved', async () => {
    const restored = seed()

    const result = await run(restored)

    expect(result).toMatchObject({repaired: 1, aborted: 0, conflict_retries: 0})
    expect(fake.calls.filter(call => call.method === 'getBlob')).toHaveLength(0)
  })

  describe('when the head cannot be read', () => {
    const originalExitCode = process.exitCode

    afterEach(() => {
      process.exitCode = originalExitCode
      vi.restoreAllMocks()
    })

    it('records an aborted result and fails the job when the head tree listing is truncated', async () => {
      const restored = seed()
      fake.advance({[SURVEY_PAGE]: 'survey\n'})
      fake.truncate(true)
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      const written: string[] = []

      const result = await runAndRecordWikiRepair({
        ...repairParams(restored),
        write: async json => {
          written.push(json)
        },
      })

      expect(result).toMatchObject({aborted: 1, repaired: 0, privacy_blocked: 0})
      expect(written).toHaveLength(1)
      expect(JSON.parse(written[0] ?? '{}')).toMatchObject({aborted: 1, repaired: 0})
      expect(process.exitCode).toBe(1)
      expect(writes()).toStrictEqual([])
    })

    it('records an aborted result when the head read fails with a server error', async () => {
      const restored = seed()
      fake.advance({[SURVEY_PAGE]: 'survey\n'})
      fake.failNext('getRef', 503)
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      const written: string[] = []

      // Data moved since the restore, so the retry's reload is the first head read, and it fails.
      const result = await runAndRecordWikiRepair({
        ...repairParams(restored),
        write: async json => {
          written.push(json)
        },
      })

      expect(result.aborted).toBe(1)
      expect(written).toHaveLength(1)
      expect(process.exitCode).toBe(1)
    })
  })

  it('fails closed when the head has no metadata/repos.yaml', async () => {
    const restored = seed()
    fake.advance({'metadata/repos.yaml': null})

    await expect(run(restored)).rejects.toThrow('metadata/repos.yaml is missing')

    expect(writes()).toStrictEqual([])
  })
})

describe('exitCodeFor', () => {
  const clean: WikiRepairResultCounts = {
    repairable_seen: 0,
    repaired: 0,
    aborted: 0,
    out_of_scope: 0,
    privacy_blocked: 0,
    path_refused: 0,
    conflict_retries: 0,
    noop: 0,
    dry_run: false,
  }

  it('is 1 when the run aborted and it was not the privacy gate (AE9)', () => {
    expect(exitCodeFor({...clean, aborted: 1})).toBe(1)
  })

  it.each([
    ['a clean run', {...clean, noop: 1}],
    ['a repaired run', {...clean, repairable_seen: 2, repaired: 2}],
    ['a privacy-leak abort', {...clean, aborted: 1, privacy_blocked: 1}],
    ['a run with only path_refused', {...clean, path_refused: 2}],
    ['a dry run', {...clean, repaired: 1, dry_run: true}],
  ])('is 0 for %s', (_name, result) => {
    expect(exitCodeFor(result)).toBe(0)
  })
})

describe('recordWikiRepairResult', () => {
  const originalExitCode = process.exitCode
  const result = (overrides: Partial<WikiRepairResultCounts>): WikiRepairResultCounts => ({
    repairable_seen: 0,
    repaired: 0,
    aborted: 0,
    out_of_scope: 0,
    privacy_blocked: 0,
    path_refused: 0,
    conflict_retries: 0,
    noop: 0,
    dry_run: false,
    ...overrides,
  })

  afterEach(() => {
    process.exitCode = originalExitCode
  })

  it.each([
    ['an aborted run', result({aborted: 1}), 1],
    ['a privacy-leak abort', result({aborted: 1, privacy_blocked: 1}), 0],
    ['a clean run', result({noop: 1}), 0],
  ])('writes the JSON, then sets the exit code, for %s', async (_name, counts, exitCode) => {
    process.exitCode = undefined
    const order: string[] = []
    const write = vi.fn(async (_json: string) => {
      order.push(`write(exitCode=${String(process.exitCode)})`)
    })

    await recordWikiRepairResult(counts, write)

    expect(write).toHaveBeenCalledWith(`${JSON.stringify(counts)}\n`)
    // The exit code is still unset while the JSON is being written.
    expect(order).toStrictEqual(['write(exitCode=undefined)'])
    expect(process.exitCode).toBe(exitCode)
  })

  it('does not set an exit code when the write fails', async () => {
    process.exitCode = undefined

    await expect(
      recordWikiRepairResult(result({aborted: 1}), async () => {
        throw new Error('disk full')
      }),
    ).rejects.toThrow('disk full')

    expect(process.exitCode).toBeUndefined()
  })
})

describe('the CLI entry builds its client through the core factory', () => {
  const ENVIRONMENT = [
    'GITHUB_TOKEN',
    'WIKI_REPAIR_DATA_TIP_SHA',
    'GRANDFATHER_WIKI_REPOS_DIR',
    'WIKI_REPAIR_DRY_RUN',
    'WIKI_REPAIR_RESULT_PATH',
  ] as const
  const saved: Record<string, string | undefined> = {}
  let root = ''
  let originalEntry: string | undefined
  let stderrLines: string[] = []
  let processSpies: {mockRestore: () => void}[] = []

  /** A checkout whose index omits an existing topic page, so a repair is planned and needs GitHub. */
  async function writeDriftedCheckout(): Promise<void> {
    const files = Object.fromEntries([
      [
        'knowledge/index.md',
        buildIndex([
          '## Repos',
          '',
          '_No repo pages yet._',
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
      ],
      buildPage({
        path: 'knowledge/wiki/topics/github-actions-ci.md',
        type: 'topic',
        title: 'GitHub Actions CI',
        bodyLines: ['Workflow conventions.'],
      }),
    ])
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), {recursive: true})
      await writeFile(join(root, path), content, 'utf8')
    }
    await mkdir(join(root, 'metadata'), {recursive: true})
    await writeFile(join(root, 'metadata', 'repos.yaml'), 'version: 1\nrepos: []\n', 'utf8')
    process.env.WIKI_REPAIR_DATA_TIP_SHA = 'tip-1'
    process.env.GRANDFATHER_WIKI_REPOS_DIR = join(root, 'grandfather')
  }

  /** Runs the CLI against `@octokit/rest` replaced by `mocked`; resolves to what the run rejected with. */
  async function runCli(mocked: Record<string, unknown>): Promise<unknown> {
    vi.resetModules()
    vi.doMock('@octokit/rest', () => mocked)
    process.argv[1] = fileURLToPath(new URL('./wiki-repair.ts', import.meta.url))
    try {
      await import('./wiki-repair.ts')
      return undefined
    } catch (error: unknown) {
      return error
    }
  }

  beforeEach(async () => {
    for (const name of ENVIRONMENT) {
      saved[name] = process.env[name]
      delete process.env[name]
    }
    originalEntry = process.argv[1]
    root = await mkdtemp(join(tmpdir(), 'wiki-repair-entry-'))
    processSpies = [
      vi.spyOn(process, 'cwd').mockReturnValue(root),
      vi.spyOn(process.stderr, 'write').mockImplementation(chunk => {
        stderrLines.push(String(chunk))
        return true
      }),
      vi.spyOn(process.stdout, 'write').mockImplementation(() => true),
    ]
    stderrLines = []
    await writeDriftedCheckout()
  })

  afterEach(async () => {
    for (const name of ENVIRONMENT) {
      if (saved[name] === undefined) delete process.env[name]
      else process.env[name] = saved[name]
    }
    if (originalEntry === undefined) process.argv.length = 1
    else process.argv[1] = originalEntry
    process.exitCode = undefined
    for (const spy of processSpies) spy.mockRestore()
    vi.doUnmock('@octokit/rest')
    vi.resetModules()
    await rm(root, {recursive: true, force: true})
  })

  it('builds the client from GITHUB_TOKEN, with no timeout and no logger', async () => {
    process.env.GITHUB_TOKEN = 'repair-token'
    const constructed: unknown[] = []

    await runCli({
      Octokit: function Octokit(options: unknown) {
        constructed.push(options)
      },
    })

    expect(constructed).toStrictEqual([{auth: 'repair-token'}])
  })

  it('without GITHUB_TOKEN, aborts with its own message and builds no client', async () => {
    const constructed: unknown[] = []

    await runCli({
      Octokit: function Octokit(options: unknown) {
        constructed.push(options)
      },
    })

    expect(stderrLines.join('')).toContain(
      '::error::wiki-repair aborted: wiki-repair: GITHUB_TOKEN is required in the environment',
    )
    expect(constructed).toStrictEqual([])
    expect(process.exitCode).toBe(1)
  })

  it.each([
    ['a missing Octokit export', {}],
    ['a non-constructor Octokit export', {Octokit: 'not a function'}],
  ])('turns %s into its own load-failure message', async (_label, mocked) => {
    process.env.GITHUB_TOKEN = 'repair-token'

    await runCli(mocked)

    expect(stderrLines.join('')).toContain(
      '::error::wiki-repair aborted: wiki-repair: failed to load @octokit/rest Octokit constructor',
    )
    expect(process.exitCode).toBe(1)
  })

  it('reports an unrelated constructor error as it is, without the load-failure message', async () => {
    process.env.GITHUB_TOKEN = 'repair-token'

    await runCli({
      Octokit: function Octokit() {
        throw new RangeError('constructor exploded')
      },
    })

    const stderr = stderrLines.join('')
    expect(stderr).toContain('::error::wiki-repair aborted: constructor exploded')
    expect(stderr).not.toContain('failed to load @octokit/rest')
    expect(process.exitCode).toBe(1)
  })
})
