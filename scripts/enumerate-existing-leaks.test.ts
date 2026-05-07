import type {ReposFile} from './schemas.ts'

import {describe, expect, it} from 'vitest'

import {
  enumerateLeaks,
  formatLeakReport,
  parsePrivateArgs,
  type EnumerateLeaksInput,
  type PrivateRepoMapping,
} from './enumerate-existing-leaks.ts'

function makePolyMapping(): PrivateRepoMapping {
  return {node_id: 'R_kgDOPpoLY1', owner: 'marcusrbrown', name: 'poly'}
}

function makeReposFile(
  overrides: Partial<ReposFile['repos'][number]> = {},
  others: ReposFile['repos'] = [],
): ReposFile {
  return {
    version: 1,
    repos: [
      {
        owner: 'marcusrbrown',
        name: 'poly',
        added: '2026-05-01',
        onboarding_status: 'pending',
        last_survey_at: null,
        last_survey_status: null,
        has_fro_bot_workflow: false,
        has_renovate: false,
        ...overrides,
      },
      ...others,
    ],
  }
}

function emptyInput(): EnumerateLeaksInput {
  return {
    privateRepos: [],
    commitLog: [],
    workflowRuns: [],
    reposFile: {version: 1, repos: []},
    wikiFilenames: [],
  }
}

describe('enumerateLeaks', () => {
  describe('happy paths', () => {
    it('returns no surfaces when the private list is empty', () => {
      // Empty list = nothing to enumerate; even rich data sources yield zero surfaces.
      const result = enumerateLeaks({
        ...emptyInput(),
        commitLog: [{sha: 'abc123', subject: 'feat: add poly support'}],
        reposFile: makeReposFile(),
        wikiFilenames: ['marcusrbrown--poly.md'],
      })

      expect(result).toEqual([])
    })

    it('enumerates all 4 surface types for the poly fixture', () => {
      // GIVEN the canonical poly fixture: 2 commits, 1 run, 1 metadata entry, 0 wiki pages
      const result = enumerateLeaks({
        privateRepos: [makePolyMapping()],
        commitLog: [
          {sha: 'd92d12c', subject: 'fix(metadata): allowlist marcusrbrown/poly invitation'},
          {sha: 'cb5811e', subject: 'chore(reconcile): add marcusrbrown/poly to repos.yaml'},
          {sha: 'unrelated1', subject: 'docs: update README'},
        ],
        workflowRuns: [{id: 25395917616, name: 'Survey Repo', inputs: {owner: 'marcusrbrown', repo: 'poly'}}],
        reposFile: makeReposFile(),
        wikiFilenames: [],
      })

      const types = result.map(s => s.type).sort()
      expect(types).toEqual(['commit-subject', 'commit-subject', 'metadata-entry', 'workflow-run'])

      // Sanity-check identifiers
      const commitSurfaces = result.filter(s => s.type === 'commit-subject')
      expect(commitSurfaces.map(s => s.identifier)).toEqual(['d92d12c', 'cb5811e'])

      const runSurface = result.find(s => s.type === 'workflow-run')
      expect(runSurface?.identifier).toBe('25395917616')

      const metaSurface = result.find(s => s.type === 'metadata-entry')
      expect(metaSurface?.identifier).toBe('marcusrbrown/poly')
    })

    it('enumerates wiki pages when matching slug patterns are present', () => {
      const result = enumerateLeaks({
        privateRepos: [makePolyMapping()],
        commitLog: [],
        workflowRuns: [],
        reposFile: {version: 1, repos: []},
        wikiFilenames: ['marcusrbrown--poly.md', 'unrelated--repo.md'],
      })

      const wikiSurfaces = result.filter(s => s.type === 'wiki-page')
      expect(wikiSurfaces).toHaveLength(1)
      expect(wikiSurfaces[0]?.identifier).toBe('marcusrbrown--poly.md')
    })

    it('returns empty surfaces for a private repo with no leaks', () => {
      const result = enumerateLeaks({
        privateRepos: [{node_id: 'R_kgDOCLEAN', owner: 'someone', name: 'clean-repo'}],
        commitLog: [{sha: 'abc', subject: 'feat: add unrelated thing'}],
        workflowRuns: [{id: 1, name: 'Main', inputs: {}}],
        reposFile: {version: 1, repos: []},
        wikiFilenames: ['unrelated--repo.md'],
      })

      expect(result).toEqual([])
    })
  })

  describe('detection rules', () => {
    it('matches commit subject case-insensitively', () => {
      const result = enumerateLeaks({
        privateRepos: [makePolyMapping()],
        commitLog: [{sha: 'mixed', subject: 'FIX: MarcusRBrown/Poly handling'}],
        workflowRuns: [],
        reposFile: {version: 1, repos: []},
        wikiFilenames: [],
      })

      expect(result.filter(s => s.type === 'commit-subject')).toHaveLength(1)
    })

    it('does NOT match a substring inside another word', () => {
      // 'poly' alone is too short to substring-match safely in arbitrary text.
      // The check requires the canonical owner/name pair to appear together.
      const result = enumerateLeaks({
        privateRepos: [makePolyMapping()],
        commitLog: [{sha: 'unrelated', subject: 'feat: support polymorphism in parser'}],
        workflowRuns: [],
        reposFile: {version: 1, repos: []},
        wikiFilenames: [],
      })

      expect(result.filter(s => s.type === 'commit-subject')).toHaveLength(0)
    })

    it('matches workflow run inputs by canonical owner/repo pair', () => {
      const result = enumerateLeaks({
        privateRepos: [makePolyMapping()],
        commitLog: [],
        workflowRuns: [
          {id: 1, name: 'Survey Repo', inputs: {owner: 'marcusrbrown', repo: 'poly'}},
          {id: 2, name: 'Survey Repo', inputs: {owner: 'someone-else', repo: 'public-repo'}},
        ],
        reposFile: {version: 1, repos: []},
        wikiFilenames: [],
      })

      expect(result.filter(s => s.type === 'workflow-run').map(s => s.identifier)).toEqual(['1'])
    })

    it('matches workflow run name when canonical owner/repo appears in the run name', () => {
      const result = enumerateLeaks({
        privateRepos: [makePolyMapping()],
        commitLog: [],
        workflowRuns: [{id: 99, name: 'Survey: marcusrbrown/poly', inputs: {}}],
        reposFile: {version: 1, repos: []},
        wikiFilenames: [],
      })

      expect(result.filter(s => s.type === 'workflow-run')).toHaveLength(1)
    })

    it('matches metadata entry by current owner/name (pre-redaction)', () => {
      const result = enumerateLeaks({
        privateRepos: [makePolyMapping()],
        commitLog: [],
        workflowRuns: [],
        reposFile: makeReposFile(),
        wikiFilenames: [],
      })

      const metaSurfaces = result.filter(s => s.type === 'metadata-entry')
      expect(metaSurfaces).toHaveLength(1)
    })

    it('does NOT report metadata entry when the entry is already redacted', () => {
      const result = enumerateLeaks({
        privateRepos: [makePolyMapping()],
        commitLog: [],
        workflowRuns: [],
        reposFile: makeReposFile({owner: '[REDACTED]', name: 'R_kgDOPpoLY1'}),
        wikiFilenames: [],
      })

      expect(result.filter(s => s.type === 'metadata-entry')).toHaveLength(0)
    })
  })

  describe('remediation commands', () => {
    it('attaches a rebase/replace-message hint for commit-subject surfaces', () => {
      const result = enumerateLeaks({
        privateRepos: [makePolyMapping()],
        commitLog: [{sha: 'd92d12c', subject: 'fix: marcusrbrown/poly'}],
        workflowRuns: [],
        reposFile: {version: 1, repos: []},
        wikiFilenames: [],
      })

      const surface = result.find(s => s.type === 'commit-subject')
      expect(surface?.remediation.action).toBe('rebase-rewrite')
      expect(surface?.remediation.command).toMatch(/git rebase|git filter-repo/)
    })

    it('attaches a delete-run command for workflow-run surfaces', () => {
      const result = enumerateLeaks({
        privateRepos: [makePolyMapping()],
        commitLog: [],
        workflowRuns: [{id: 25395917616, name: 'Survey Repo', inputs: {owner: 'marcusrbrown', repo: 'poly'}}],
        reposFile: {version: 1, repos: []},
        wikiFilenames: [],
      })

      const surface = result.find(s => s.type === 'workflow-run')
      expect(surface?.remediation.action).toBe('delete-run')
      expect(surface?.remediation.command).toContain('25395917616')
      expect(surface?.remediation.command).toContain('DELETE')
    })

    it('attaches a redact-entry command for metadata-entry surfaces', () => {
      const result = enumerateLeaks({
        privateRepos: [makePolyMapping()],
        commitLog: [],
        workflowRuns: [],
        reposFile: makeReposFile(),
        wikiFilenames: [],
      })

      const surface = result.find(s => s.type === 'metadata-entry')
      expect(surface?.remediation.action).toBe('redact-entry')
      // Must reference the node_id since that's the post-redaction name
      expect(surface?.remediation.command).toContain('R_kgDOPpoLY1')
    })

    it('attaches a delete-page command for wiki-page surfaces', () => {
      const result = enumerateLeaks({
        privateRepos: [makePolyMapping()],
        commitLog: [],
        workflowRuns: [],
        reposFile: {version: 1, repos: []},
        wikiFilenames: ['marcusrbrown--poly.md'],
      })

      const surface = result.find(s => s.type === 'wiki-page')
      expect(surface?.remediation.action).toBe('delete-page')
      expect(surface?.remediation.command).toContain('marcusrbrown--poly.md')
    })
  })

  describe('multi-repo enumeration', () => {
    it('enumerates surfaces across multiple private repos in a single call', () => {
      const result = enumerateLeaks({
        privateRepos: [
          {node_id: 'R_a', owner: 'org-a', name: 'repo-a'},
          {node_id: 'R_b', owner: 'org-b', name: 'repo-b'},
        ],
        commitLog: [
          {sha: '1', subject: 'feat: org-a/repo-a thing'},
          {sha: '2', subject: 'fix: org-b/repo-b thing'},
        ],
        workflowRuns: [],
        reposFile: {version: 1, repos: []},
        wikiFilenames: [],
      })

      expect(result.filter(s => s.type === 'commit-subject')).toHaveLength(2)
    })
  })
})

describe('formatLeakReport', () => {
  it('returns a "no surfaces" message when given an empty array', () => {
    expect(formatLeakReport([])).toMatch(/no leak surfaces|none found/i)
  })

  it('groups surfaces by type and lists remediation commands', () => {
    const report = formatLeakReport([
      {
        type: 'commit-subject',
        identifier: 'd92d12c',
        description: 'commit subject names marcusrbrown/poly',
        remediation: {action: 'rebase-rewrite', command: 'git rebase -i d92d12c~1'},
      },
      {
        type: 'workflow-run',
        identifier: '25395917616',
        description: 'workflow run inputs name marcusrbrown/poly',
        remediation: {action: 'delete-run', command: 'gh api -X DELETE /repos/.../actions/runs/25395917616'},
      },
    ])

    expect(report).toContain('commit-subject')
    expect(report).toContain('d92d12c')
    expect(report).toContain('git rebase')
    expect(report).toContain('workflow-run')
    expect(report).toContain('25395917616')
    expect(report).toContain('DELETE')
  })
})

describe('parsePrivateArgs', () => {
  it('parses a single well-formed --private mapping', () => {
    const result = parsePrivateArgs(['--private', 'R_kgDOPpoLY1:marcusrbrown/poly'])
    expect(result).toEqual([{node_id: 'R_kgDOPpoLY1', owner: 'marcusrbrown', name: 'poly'}])
  })

  it('parses multiple --private flags into an ordered list', () => {
    const result = parsePrivateArgs(['--private', 'R_a:org-a/repo-a', '--private', 'R_b:org-b/repo-b'])
    expect(result).toEqual([
      {node_id: 'R_a', owner: 'org-a', name: 'repo-a'},
      {node_id: 'R_b', owner: 'org-b', name: 'repo-b'},
    ])
  })

  it('returns an empty array when no --private flags are present', () => {
    expect(parsePrivateArgs(['--branch', 'origin/data'])).toEqual([])
  })

  it('throws when --private is the last arg with no value', () => {
    // Real edge case: operator types `--private` and forgets the value. Without
    // this guard the parser would silently skip the flag.
    expect(() => parsePrivateArgs(['--private'])).toThrow(/requires a value/)
  })

  it('throws when the value lacks a colon separator', () => {
    expect(() => parsePrivateArgs(['--private', 'no-colon-here'])).toThrow(/node_id:owner\/name/)
  })

  it('throws when the value lacks a slash after the colon', () => {
    expect(() => parsePrivateArgs(['--private', 'node_id:no-slash'])).toThrow(/node_id:owner\/name/)
  })

  it('throws when the slash appears before the colon', () => {
    // 'org/name:nodeid' is a common typo — operator inverts the order. Catch it
    // explicitly so the error message points at the right shape.
    expect(() => parsePrivateArgs(['--private', 'org/name:nodeid'])).toThrow(/node_id:owner\/name/)
  })

  it('throws when any segment is empty', () => {
    expect(() => parsePrivateArgs(['--private', ':owner/name'])).toThrow(/empty segment/)
    expect(() => parsePrivateArgs(['--private', 'nodeid:/name'])).toThrow(/empty segment/)
    expect(() => parsePrivateArgs(['--private', 'nodeid:owner/'])).toThrow(/empty segment/)
  })

  it('skips non-matching flags and only consumes --private', () => {
    // Operator may pass --branch interleaved with --private; the parser should
    // ignore unrelated flags rather than misinterpreting their values.
    const result = parsePrivateArgs(['--branch', 'origin/data', '--private', 'R_a:org/repo', '--help'])
    expect(result).toEqual([{node_id: 'R_a', owner: 'org', name: 'repo'}])
  })

  it('handles node_id values containing letters, digits, and underscores', () => {
    // GraphQL node IDs use base64-like prefixes (R_kgDO...) plus arbitrary suffixes.
    // The parser must accept the full character set the API can return.
    const result = parsePrivateArgs(['--private', 'R_kgDO_AbCdEf123-_:owner/repo'])
    expect(result[0]?.node_id).toBe('R_kgDO_AbCdEf123-_')
  })
})
