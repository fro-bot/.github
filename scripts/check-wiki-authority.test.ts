import {describe, expect, it} from 'vitest'

import {checkWikiAuthority, formatBlockMessage} from './check-wiki-authority.ts'

describe('checkWikiAuthority', () => {
  describe('author is an allowed Fro Bot identity', () => {
    it('allows fro-bot[bot] editing a guarded metadata yaml', () => {
      // #given the App installation author touching metadata/repos.yaml
      // #when the guard evaluates the PR
      // #then the edit is allowed (fro-bot[bot] is the promotion-PR identity)
      const result = checkWikiAuthority({author: 'fro-bot[bot]', files: ['metadata/repos.yaml']})
      expect(result).toEqual({ok: true})
    })

    it('allows fro-bot user editing a guarded wiki page', () => {
      // #given the user-token author (FRO_BOT_PAT writes) touching a wiki page
      // #when the guard evaluates the PR
      // #then the edit is allowed (fro-bot and fro-bot[bot] are one operator)
      const result = checkWikiAuthority({
        author: 'fro-bot',
        files: ['knowledge/wiki/topics/home-assistant.md'],
      })
      expect(result).toEqual({ok: true})
    })

    it('allows fro-bot[bot] editing multiple guarded paths in one PR', () => {
      // #given a promotion-style PR touching wiki, index, log, and metadata together
      // #when the guard evaluates the PR
      // #then every guarded path is allowed under the Fro Bot identity
      const result = checkWikiAuthority({
        author: 'fro-bot[bot]',
        files: [
          'knowledge/wiki/repos/marcusrbrown--x.md',
          'metadata/allowlist.yaml',
          'knowledge/index.md',
          'knowledge/log.md',
        ],
      })
      expect(result).toEqual({ok: true})
    })
  })

  describe('author is not Fro Bot; only unguarded files touched', () => {
    it('allows arbitrary source-file edits', () => {
      // #given a human PR touching only application code and top-level docs
      // #when the guard evaluates the PR
      // #then the edit is allowed (no guarded paths present)
      const result = checkWikiAuthority({author: 'marcusrbrown', files: ['README.md', 'src/foo.ts']})
      expect(result).toEqual({ok: true})
    })

    it('allows an empty file list (vacuous case)', () => {
      // #given a PR whose file list is empty (edge case)
      // #when the guard evaluates the PR
      // #then the guard does not fire (nothing to check)
      const result = checkWikiAuthority({author: 'marcusrbrown', files: []})
      expect(result).toEqual({ok: true})
    })

    it('allows editing knowledge/schema.md (human-editable conventions doc)', () => {
      // #given the Karpathy-style conventions doc edited by a human
      // #when the guard evaluates the PR
      // #then the edit is allowed (schema is intentionally outside the guard)
      const result = checkWikiAuthority({author: 'marcusrbrown', files: ['knowledge/schema.md']})
      expect(result).toEqual({ok: true})
    })

    it('allows editing knowledge/README.md', () => {
      // #given a human edit to the knowledge directory's README
      // #when the guard evaluates the PR
      // #then the edit is allowed (READMEs are human-editable)
      const result = checkWikiAuthority({author: 'marcusrbrown', files: ['knowledge/README.md']})
      expect(result).toEqual({ok: true})
    })

    it('allows editing knowledge/wiki/README.md', () => {
      // #given a human edit to the wiki directory's README
      // #when the guard evaluates the PR
      // #then the edit is allowed (README is outside the auto-managed wiki content)
      const result = checkWikiAuthority({author: 'marcusrbrown', files: ['knowledge/wiki/README.md']})
      expect(result).toEqual({ok: true})
    })

    it('allows editing metadata/README.md', () => {
      // #given a human edit to the metadata directory's README
      // #when the guard evaluates the PR
      // #then the edit is allowed (only *.yaml files in metadata/ are guarded)
      const result = checkWikiAuthority({author: 'marcusrbrown', files: ['metadata/README.md']})
      expect(result).toEqual({ok: true})
    })
  })

  describe('author is not Fro Bot; guarded files touched', () => {
    it('blocks a human PR editing metadata/repos.yaml', () => {
      // #given a human author touching an auto-managed metadata yaml
      // #when the guard evaluates the PR
      // #then the edit is blocked and the file is listed
      const result = checkWikiAuthority({author: 'marcusrbrown', files: ['metadata/repos.yaml']})
      expect(result).toEqual({ok: false, blockedFiles: ['metadata/repos.yaml']})
    })

    it('blocks a human PR editing a knowledge/wiki page', () => {
      // #given a human author touching an auto-managed wiki page
      // #when the guard evaluates the PR
      // #then the edit is blocked
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        files: ['knowledge/wiki/topics/home-assistant.md'],
      })
      expect(result).toEqual({ok: false, blockedFiles: ['knowledge/wiki/topics/home-assistant.md']})
    })

    it('blocks a human PR editing knowledge/index.md', () => {
      // #given a human author touching the wiki catalog
      // #when the guard evaluates the PR
      // #then the edit is blocked
      const result = checkWikiAuthority({author: 'marcusrbrown', files: ['knowledge/index.md']})
      expect(result).toEqual({ok: false, blockedFiles: ['knowledge/index.md']})
    })

    it('blocks a human PR editing knowledge/log.md', () => {
      // #given a human author touching the append-only wiki log
      // #when the guard evaluates the PR
      // #then the edit is blocked
      const result = checkWikiAuthority({author: 'marcusrbrown', files: ['knowledge/log.md']})
      expect(result).toEqual({ok: false, blockedFiles: ['knowledge/log.md']})
    })

    it('lists only the guarded files when mixed with unguarded files', () => {
      // #given a human author touching both code and a single guarded yaml
      // #when the guard evaluates the PR
      // #then blockedFiles contains only the guarded file, not the code file
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        files: ['src/foo.ts', 'metadata/repos.yaml'],
      })
      expect(result).toEqual({ok: false, blockedFiles: ['metadata/repos.yaml']})
    })

    it('preserves input order when multiple guarded files are blocked', () => {
      // #given a human author touching every guarded surface at once
      // #when the guard evaluates the PR
      // #then blockedFiles lists every guarded path in the original order
      const files = ['metadata/repos.yaml', 'knowledge/wiki/repos/x.md', 'knowledge/index.md', 'knowledge/log.md']
      const result = checkWikiAuthority({author: 'marcusrbrown', files})
      expect(result).toEqual({ok: false, blockedFiles: files})
    })

    it('blocks github-actions[bot] (not a Fro Bot identity)', () => {
      // #given the default GITHUB_TOKEN identity touching a guarded file
      // #when the guard evaluates the PR
      // #then the edit is blocked — only fro-bot and fro-bot[bot] are authorized
      const result = checkWikiAuthority({
        author: 'github-actions[bot]',
        files: ['metadata/repos.yaml'],
      })
      expect(result).toEqual({ok: false, blockedFiles: ['metadata/repos.yaml']})
    })

    it('blocks dependabot[bot] (defensive, should never touch guarded files)', () => {
      // #given a random bot identity touching a guarded file
      // #when the guard evaluates the PR
      // #then the edit is blocked — the guard fails closed on unknown identities
      const result = checkWikiAuthority({
        author: 'dependabot[bot]',
        files: ['metadata/repos.yaml'],
      })
      expect(result).toEqual({ok: false, blockedFiles: ['metadata/repos.yaml']})
    })
  })

  describe('path-matching edge cases', () => {
    it('blocks nested wiki subdirectories via the wiki glob', () => {
      // #given a deep nested wiki path
      // #when the guard evaluates the PR
      // #then the knowledge/wiki/** glob matches at any depth
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        files: ['knowledge/wiki/comparisons/x-vs-y.md'],
      })
      expect(result).toEqual({ok: false, blockedFiles: ['knowledge/wiki/comparisons/x-vs-y.md']})
    })

    it('blocks hypothetical future metadata/*.yaml files', () => {
      // #given a new yaml file that could be added to metadata/ in future
      // #when the guard evaluates the PR
      // #then the single-segment glob covers it without needing a guard update
      const result = checkWikiAuthority({author: 'marcusrbrown', files: ['metadata/new-thing.yaml']})
      expect(result).toEqual({ok: false, blockedFiles: ['metadata/new-thing.yaml']})
    })

    it('does not block metadata/<subdir>/*.yaml (single-segment glob by design)', () => {
      // #given a hypothetical nested metadata file
      // #when the guard evaluates the PR
      // #then the edit is NOT blocked — if nested metadata is added later, the glob is revisited
      const result = checkWikiAuthority({author: 'marcusrbrown', files: ['metadata/subdir/x.yaml']})
      expect(result).toEqual({ok: true})
    })

    it('does not block metadata/*.yml (wrong extension)', () => {
      // #given a yaml file with the non-canonical .yml extension
      // #when the guard evaluates the PR
      // #then the edit is NOT blocked — the repo convention is *.yaml, and guard matches that literally
      const result = checkWikiAuthority({author: 'marcusrbrown', files: ['metadata/repos.yml']})
      expect(result).toEqual({ok: true})
    })

    it('does not block files named like the guarded ones but outside the guarded prefix', () => {
      // #given files with guard-lookalike names at other locations
      // #when the guard evaluates the PR
      // #then the edit is NOT blocked — anchored regexes only match the canonical prefixes
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        files: ['docs/knowledge/index.md', 'backup/metadata/repos.yaml', 'src/knowledge/wiki/x.md'],
      })
      expect(result).toEqual({ok: true})
    })
  })
})

describe('formatBlockMessage', () => {
  it('names every blocked file in the message', () => {
    // #given a result blocking two guarded files
    // #when the failure message is formatted
    // #then each blocked path appears in the output
    const msg = formatBlockMessage({
      ok: false,
      blockedFiles: ['metadata/repos.yaml', 'knowledge/wiki/topics/home-assistant.md'],
    })
    expect(msg).toContain('metadata/repos.yaml')
    expect(msg).toContain('knowledge/wiki/topics/home-assistant.md')
  })

  it('names the data branch as the resubmission path', () => {
    // #given any block result
    // #when the failure message is formatted
    // #then the message instructs the PR author to land edits via `data`
    const msg = formatBlockMessage({ok: false, blockedFiles: ['metadata/repos.yaml']})
    expect(msg.toLowerCase()).toContain('data branch')
  })

  it('names both Fro Bot identities as the authorized writers', () => {
    // #given any block result
    // #when the failure message is formatted
    // #then both `fro-bot` and `fro-bot[bot]` appear so the reader sees the equivalence
    const msg = formatBlockMessage({ok: false, blockedFiles: ['metadata/repos.yaml']})
    expect(msg).toContain('fro-bot')
    expect(msg).toContain('fro-bot[bot]')
  })

  it('produces non-empty output', () => {
    // #given a minimal block result
    // #when the failure message is formatted
    // #then the output is a non-trivial string the CI log can surface
    const msg = formatBlockMessage({ok: false, blockedFiles: ['metadata/repos.yaml']})
    expect(msg.length).toBeGreaterThan(50)
  })
})
