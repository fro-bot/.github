import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {CORRECTIONS_PATH} from '@fro-bot/wiki-write-core/corrections'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  checkWikiAuthority,
  fetchChangedFiles,
  formatBlockMessage,
  readPullRequestContext,
} from './check-wiki-authority.ts'

// Hoisted mock for execFileSync — must precede any import that might trigger the module.
const {mockExecFileSync} = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}))

// Shared by the readPullRequestContext discrimination tests and the CLI self-invoke guard tests
// below — both need a real event-payload file on disk (readFile in the module under test is real,
// not mocked). Module scope, not nested inside a describe, per unicorn/consistent-function-scoping:
// the helper closes over no test-local state.
function writeTempEvent(prefix: string, payload: unknown): {eventPath: string; cleanup: () => void} {
  const tmpDir = mkdtempSync(join(tmpdir(), prefix))
  const eventPath = join(tmpDir, 'event.json')
  writeFileSync(eventPath, JSON.stringify(payload), 'utf8')
  return {eventPath, cleanup: () => rmSync(tmpDir, {recursive: true, force: true})}
}

// The repository the guard runs in; a Fro Bot allow additionally requires the PR's head repo to be it.
const THIS_REPO = 'fro-bot/.github'

describe('checkWikiAuthority', () => {
  describe('author is an allowed Fro Bot identity', () => {
    it('allows fro-bot[bot] editing a guarded metadata yaml', () => {
      // #given the App installation author touching metadata/repos.yaml
      // #when the guard evaluates the PR
      // #then the edit is allowed (fro-bot[bot] is the promotion-PR identity)
      const result = checkWikiAuthority({
        author: 'fro-bot[bot]',
        headRef: 'data',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['metadata/repos.yaml'],
      })
      expect(result).toEqual({ok: true})
    })

    it('allows fro-bot user editing a guarded wiki page', () => {
      // #given the user-token author (FRO_BOT_PAT writes) touching a wiki page
      // #when the guard evaluates the PR
      // #then the edit is allowed (fro-bot and fro-bot[bot] are one operator)
      const result = checkWikiAuthority({
        author: 'fro-bot',
        headRef: 'data',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
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
        headRef: 'data',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: [
          'knowledge/wiki/repos/marcusrbrown--x.md',
          'metadata/allowlist.yaml',
          'knowledge/index.md',
          'knowledge/log.md',
        ],
      })
      expect(result).toEqual({ok: true})
    })

    it('allows fro-bot from data branch editing metadata/repos.yaml (promotion path)', () => {
      // #given fro-bot on the `data` branch touching metadata/repos.yaml
      // #when the guard evaluates the PR
      // #then the edit is allowed — this is the legitimate promotion path
      const result = checkWikiAuthority({
        author: 'fro-bot',
        headRef: 'data',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['metadata/repos.yaml'],
      })
      expect(result).toEqual({ok: true})
    })

    it('blocks fro-bot editing metadata/repos.yaml from a non-data branch (both-sides mutation)', () => {
      // #given fro-bot on a feature branch (not `data`) touching metadata/repos.yaml
      // #when the guard evaluates the PR
      // #then the edit is blocked — this is the prohibited both-sides mutation pattern (#3394)
      const result = checkWikiAuthority({
        author: 'fro-bot',
        headRef: 'fix/something',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['metadata/repos.yaml'],
      })
      expect(result).toEqual({ok: false, blockedFiles: ['metadata/repos.yaml']})
    })

    it('blocks fro-bot[bot] editing metadata/repos.yaml from a non-data branch', () => {
      // #given fro-bot[bot] on a non-data branch touching metadata/repos.yaml
      // #when the guard evaluates the PR
      // #then the edit is blocked — repos.yaml can only come from `data`
      const result = checkWikiAuthority({
        author: 'fro-bot[bot]',
        headRef: 'feature/something',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['metadata/repos.yaml'],
      })
      expect(result).toEqual({ok: false, blockedFiles: ['metadata/repos.yaml']})
    })

    it('blocks fro-bot editing metadata/allowlist.yaml from a non-data branch (every guarded path needs data)', () => {
      // #given fro-bot on a feature branch touching a guarded metadata yaml that is NOT repos.yaml
      // #when the guard evaluates the PR
      // #then the edit is blocked — the head-ref requirement covers every guarded path, not only repos.yaml
      const result = checkWikiAuthority({
        author: 'fro-bot',
        headRef: 'fix/something',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['metadata/allowlist.yaml'],
      })
      expect(result).toEqual({ok: false, blockedFiles: ['metadata/allowlist.yaml']})
    })

    it('allows fro-bot on data branch editing other guarded files (wiki, index, log)', () => {
      // #given fro-bot on `data` touching wiki and knowledge files (not repos.yaml)
      // #when the guard evaluates the PR
      // #then the edit is allowed — unchanged behavior for other guarded files
      const result = checkWikiAuthority({
        author: 'fro-bot',
        headRef: 'data',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['knowledge/wiki/topics/x.md', 'knowledge/index.md', 'knowledge/log.md'],
      })
      expect(result).toEqual({ok: true})
    })
  })

  describe('Fro Bot authors: every guarded path requires the data head (truth table)', () => {
    // One representative file per guardedPatterns() entry, so a dropped or reordered pattern
    // changes a specific row instead of hiding behind the others.
    const guardedByPattern = [
      ['knowledge/wiki/<subdir>/*.md', 'knowledge/wiki/topics/x.md'],
      ['knowledge/index.md', 'knowledge/index.md'],
      ['knowledge/log.md', 'knowledge/log.md'],
      ['knowledge/corrections.yaml', CORRECTIONS_PATH],
      ['metadata/*.yaml', 'metadata/repos.yaml'],
      ['metadata/*.yaml (non-repos)', 'metadata/allowlist.yaml'],
      ['metadata/*.yml', 'metadata/social.yml'],
    ] as const
    const authors = ['fro-bot', 'fro-bot[bot]'] as const

    describe.each(guardedByPattern)('%s', (_label, file) => {
      it.each(authors)('allows %s on the data head', author => {
        expect(
          checkWikiAuthority({author, headRef: 'data', headRepo: THIS_REPO, baseRepo: THIS_REPO, files: [file]}),
        ).toEqual({ok: true})
      })

      it.each(authors)('blocks %s on a non-data head, listing exactly the file', author => {
        expect(
          checkWikiAuthority({
            author,
            headRef: 'fix/something',
            headRepo: THIS_REPO,
            baseRepo: THIS_REPO,
            files: [file],
          }),
        ).toEqual({
          ok: false,
          blockedFiles: [file],
        })
      })

      it.each(authors)('blocks %s on the data head when the PR comes from a different repository', author => {
        expect(
          checkWikiAuthority({
            author,
            headRef: 'data',
            headRepo: 'contributor-fork/.github',
            baseRepo: THIS_REPO,
            files: [file],
          }),
        ).toEqual({ok: false, blockedFiles: [file]})
      })

      it('still blocks a non-Fro-Bot author on the data head', () => {
        expect(
          checkWikiAuthority({
            author: 'marcusrbrown',
            headRef: 'data',
            headRepo: THIS_REPO,
            baseRepo: THIS_REPO,
            files: [file],
          }),
        ).toEqual({
          ok: false,
          blockedFiles: [file],
        })
      })
    })

    it.each(authors)('allows %s with only unguarded paths on any head', author => {
      const files = ['scripts/foo.ts', 'knowledge/schema.md', 'metadata/README.md', 'metadata/sub/x.yaml']
      expect(
        checkWikiAuthority({author, headRef: 'fix/something', headRepo: THIS_REPO, baseRepo: THIS_REPO, files}),
      ).toEqual({ok: true})
      expect(checkWikiAuthority({author, headRef: 'data', headRepo: THIS_REPO, baseRepo: THIS_REPO, files})).toEqual({
        ok: true,
      })
    })

    it('allows a promotion PR (fro-bot[bot], head data, mixed guarded and unguarded paths)', () => {
      const result = checkWikiAuthority({
        author: 'fro-bot[bot]',
        headRef: 'data',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['scripts/foo.ts', 'metadata/repos.yaml', 'knowledge/wiki/repos/x.md', 'docs/a.md', CORRECTIONS_PATH],
      })
      expect(result).toEqual({ok: true})
    })

    it('lists only the guarded files, in input order, when mixed with unguarded files on a non-data head', () => {
      const result = checkWikiAuthority({
        author: 'fro-bot',
        headRef: 'fix/something',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['scripts/foo.ts', 'metadata/repos.yaml', 'README.md', 'knowledge/index.md', 'metadata/sub/x.yaml'],
      })
      expect(result).toEqual({ok: false, blockedFiles: ['metadata/repos.yaml', 'knowledge/index.md']})
    })

    it('lists every guarded pattern in input order on a non-data head', () => {
      const files = guardedByPattern.map(([, file]) => file)
      expect(
        checkWikiAuthority({
          author: 'fro-bot',
          headRef: 'fix/something',
          headRepo: THIS_REPO,
          baseRepo: THIS_REPO,
          files,
        }),
      ).toEqual({
        ok: false,
        blockedFiles: files,
      })
    })

    it.each([
      ['a one-element array', ['data']],
      ['undefined', undefined],
      ['null', null],
      ['a differently-cased string', 'Data'],
      ['a string with trailing whitespace', 'data '],
      ['the empty string', ''],
      ['a String object', new Object('data')],
    ])('blocks a guarded path when headRef is %s (exact string match only)', (_label, headRef) => {
      const result = checkWikiAuthority({
        author: 'fro-bot',
        headRef,
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['metadata/repos.yaml'],
      })
      expect(result).toEqual({ok: false, blockedFiles: ['metadata/repos.yaml']})
    })

    it.each([
      ['undefined (no head repo in the payload)', undefined],
      ['null (deleted fork)', null],
      ['a one-element array holding the base repo', [THIS_REPO]],
      ['a differently-cased repo name', 'Fro-Bot/.github'],
      ['the base repo with trailing whitespace', `${THIS_REPO} `],
      ['a same-named repo under another owner', 'contributor-fork/.github'],
      ['a String object', new Object(THIS_REPO)],
    ])('blocks a guarded path on the data head when headRepo is %s (exact string match only)', (_label, headRepo) => {
      const result = checkWikiAuthority({
        author: 'fro-bot',
        headRef: 'data',
        headRepo,
        baseRepo: THIS_REPO,
        files: ['metadata/repos.yaml'],
      })
      expect(result).toEqual({ok: false, blockedFiles: ['metadata/repos.yaml']})
    })

    it('blocks when both repos are the empty string (an unresolved base repo never matches)', () => {
      const result = checkWikiAuthority({
        author: 'fro-bot',
        headRef: 'data',
        headRepo: '',
        baseRepo: '',
        files: ['metadata/repos.yaml'],
      })
      expect(result).toEqual({ok: false, blockedFiles: ['metadata/repos.yaml']})
    })

    it("allows a promotion from this repository's own data branch (head repo equals base repo)", () => {
      const result = checkWikiAuthority({
        author: 'fro-bot[bot]',
        headRef: 'data',
        headRepo: 'fro-bot/.github',
        baseRepo: 'fro-bot/.github',
        files: ['metadata/repos.yaml', 'knowledge/index.md', 'scripts/foo.ts'],
      })
      expect(result).toEqual({ok: true})
    })

    it('allows a fork-origin PR that touches only unguarded paths (the repo check gates guarded paths only)', () => {
      const result = checkWikiAuthority({
        author: 'fro-bot',
        headRef: 'data',
        headRepo: 'contributor-fork/.github',
        baseRepo: THIS_REPO,
        files: ['scripts/foo.ts'],
      })
      expect(result).toEqual({ok: true})
    })
  })

  describe('author is not Fro Bot; only unguarded files touched', () => {
    it('allows arbitrary source-file edits', () => {
      // #given a human PR touching only application code and top-level docs
      // #when the guard evaluates the PR
      // #then the edit is allowed (no guarded paths present)
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['README.md', 'src/foo.ts'],
      })
      expect(result).toEqual({ok: true})
    })

    it('allows an empty file list (vacuous case)', () => {
      // #given a PR whose file list is empty (edge case)
      // #when the guard evaluates the PR
      // #then the guard does not fire (nothing to check)
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: [],
      })
      expect(result).toEqual({ok: true})
    })

    it('allows editing knowledge/schema.md (human-editable conventions doc)', () => {
      // #given the Karpathy-style conventions doc edited by a human
      // #when the guard evaluates the PR
      // #then the edit is allowed (schema is intentionally outside the guard)
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['knowledge/schema.md'],
      })
      expect(result).toEqual({ok: true})
    })

    it('allows editing knowledge/README.md', () => {
      // #given a human edit to the knowledge directory's README
      // #when the guard evaluates the PR
      // #then the edit is allowed (READMEs are human-editable)
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['knowledge/README.md'],
      })
      expect(result).toEqual({ok: true})
    })

    it('allows editing knowledge/wiki/README.md', () => {
      // #given a human edit to the wiki directory's README
      // #when the guard evaluates the PR
      // #then the edit is allowed (README is outside the auto-managed wiki content)
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['knowledge/wiki/README.md'],
      })
      expect(result).toEqual({ok: true})
    })

    it('allows editing metadata/README.md', () => {
      // #given a human edit to the metadata directory's README
      // #when the guard evaluates the PR
      // #then the edit is allowed (only *.yaml files in metadata/ are guarded)
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['metadata/README.md'],
      })
      expect(result).toEqual({ok: true})
    })
  })

  describe('author is not Fro Bot; guarded files touched', () => {
    it('blocks a human PR editing metadata/repos.yaml', () => {
      // #given a human author touching an auto-managed metadata yaml
      // #when the guard evaluates the PR
      // #then the edit is blocked and the file is listed
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['metadata/repos.yaml'],
      })
      expect(result).toEqual({ok: false, blockedFiles: ['metadata/repos.yaml']})
    })

    it('blocks a human PR editing a knowledge/wiki page', () => {
      // #given a human author touching an auto-managed wiki page
      // #when the guard evaluates the PR
      // #then the edit is blocked
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['knowledge/wiki/topics/home-assistant.md'],
      })
      expect(result).toEqual({ok: false, blockedFiles: ['knowledge/wiki/topics/home-assistant.md']})
    })

    it('blocks a human PR editing knowledge/index.md', () => {
      // #given a human author touching the wiki catalog
      // #when the guard evaluates the PR
      // #then the edit is blocked
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['knowledge/index.md'],
      })
      expect(result).toEqual({ok: false, blockedFiles: ['knowledge/index.md']})
    })

    it('blocks a human PR editing knowledge/log.md', () => {
      // #given a human author touching the append-only wiki log
      // #when the guard evaluates the PR
      // #then the edit is blocked
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['knowledge/log.md'],
      })
      expect(result).toEqual({ok: false, blockedFiles: ['knowledge/log.md']})
    })

    it('lists only the guarded files when mixed with unguarded files', () => {
      // #given a human author touching both code and a single guarded yaml
      // #when the guard evaluates the PR
      // #then blockedFiles contains only the guarded file, not the code file
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['src/foo.ts', 'metadata/repos.yaml'],
      })
      expect(result).toEqual({ok: false, blockedFiles: ['metadata/repos.yaml']})
    })

    it('preserves input order when multiple guarded files are blocked', () => {
      // #given a human author touching every guarded surface at once
      // #when the guard evaluates the PR
      // #then blockedFiles lists every guarded path in the original order
      const files = ['metadata/repos.yaml', 'knowledge/wiki/repos/x.md', 'knowledge/index.md', 'knowledge/log.md']
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files,
      })
      expect(result).toEqual({ok: false, blockedFiles: files})
    })

    it('blocks github-actions[bot] (not a Fro Bot identity)', () => {
      // #given the default GITHUB_TOKEN identity touching a guarded file
      // #when the guard evaluates the PR
      // #then the edit is blocked — only fro-bot and fro-bot[bot] are authorized
      const result = checkWikiAuthority({
        author: 'github-actions[bot]',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
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
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['metadata/repos.yaml'],
      })
      expect(result).toEqual({ok: false, blockedFiles: ['metadata/repos.yaml']})
    })

    it('blocks fro-bot[bot] with a trailing space (near-miss identity, exact-match only)', () => {
      // #given a string that is not the exact identity in the frobotAuthors() set
      // #when the guard evaluates the PR
      // #then the edit is blocked — Set#has requires an exact string match, not a trimmed one
      const result = checkWikiAuthority({
        author: 'fro-bot[bot] ',
        headRef: 'data',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['metadata/repos.yaml'],
      })
      expect(result).toEqual({ok: false, blockedFiles: ['metadata/repos.yaml']})
    })

    it('blocks Fro-Bot (near-miss identity, case-sensitive match only)', () => {
      // #given a differently-cased spelling of a real identity
      // #when the guard evaluates the PR
      // #then the edit is blocked — identity matching is case-sensitive
      const result = checkWikiAuthority({
        author: 'Fro-Bot',
        headRef: 'data',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['metadata/repos.yaml'],
      })
      expect(result).toEqual({ok: false, blockedFiles: ['metadata/repos.yaml']})
    })

    it('blocks fro-bot on head ref "datab" (near-miss branch, exact-match only)', () => {
      // #given fro-bot on a branch whose name merely starts with "data"
      // #when the guard evaluates the PR touching metadata/repos.yaml
      // #then the edit is blocked — headRef must equal "data" exactly, not merely start with it
      const result = checkWikiAuthority({
        author: 'fro-bot',
        headRef: 'datab',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['metadata/repos.yaml'],
      })
      expect(result).toEqual({ok: false, blockedFiles: ['metadata/repos.yaml']})
    })

    it('blocks fro-bot on head ref "main" (near-miss branch)', () => {
      // #given fro-bot on the main branch touching metadata/repos.yaml
      // #when the guard evaluates the PR
      // #then the edit is blocked — only the literal "data" branch is exempt
      const result = checkWikiAuthority({
        author: 'fro-bot',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['metadata/repos.yaml'],
      })
      expect(result).toEqual({ok: false, blockedFiles: ['metadata/repos.yaml']})
    })
  })

  describe('path-matching edge cases', () => {
    it('guards the system-owned corrections sidecar path', () => {
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: [CORRECTIONS_PATH],
      })
      expect(result).toEqual({ok: false, blockedFiles: [CORRECTIONS_PATH]})
    })

    it('blocks nested wiki subdirectories via the wiki glob', () => {
      // #given a deep nested wiki path
      // #when the guard evaluates the PR
      // #then the knowledge/wiki/** glob matches at any depth
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['knowledge/wiki/comparisons/x-vs-y.md'],
      })
      expect(result).toEqual({ok: false, blockedFiles: ['knowledge/wiki/comparisons/x-vs-y.md']})
    })

    it('blocks metadata/allowlist.yaml for human authors (data-branch promotion required)', () => {
      // #given a human author touching the allowlist
      // #when the guard evaluates the PR
      // #then the edit is blocked — even human-curated allowlist edits land via data branch
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['metadata/allowlist.yaml'],
      })
      expect(result).toEqual({ok: false, blockedFiles: ['metadata/allowlist.yaml']})
    })

    it('blocks metadata/renovate.yaml for human authors (auto-managed by metadata workflow)', () => {
      // #given a human author touching the renovate dispatch list
      // #when the guard evaluates the PR
      // #then the edit is blocked — renovate.yaml is rebuilt by the metadata workflow
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['metadata/renovate.yaml'],
      })
      expect(result).toEqual({ok: false, blockedFiles: ['metadata/renovate.yaml']})
    })

    it('blocks hypothetical future metadata/*.yaml files (guard is path-glob, not explicit list)', () => {
      // #given a new yaml file added to metadata/ in the future
      // #when the guard evaluates the PR
      // #then the edit is blocked by default — new metadata files inherit the data-branch contract
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['metadata/new-thing.yaml'],
      })
      expect(result).toEqual({ok: false, blockedFiles: ['metadata/new-thing.yaml']})
    })

    it('blocks metadata/social-cooldowns.yaml for human authors', () => {
      // #given a human author touching auto-managed social cooldown state
      // #when the guard evaluates the PR
      // #then the edit is blocked — social-cooldowns.yaml is auto-managed
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['metadata/social-cooldowns.yaml'],
      })
      expect(result).toEqual({ok: false, blockedFiles: ['metadata/social-cooldowns.yaml']})
    })

    it('does not block metadata/<subdir>/*.yaml (single-segment glob by design)', () => {
      // #given a hypothetical nested metadata file
      // #when the guard evaluates the PR
      // #then the edit is NOT blocked — if nested metadata is added later, the glob is revisited
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['metadata/subdir/x.yaml'],
      })
      expect(result).toEqual({ok: true})
    })

    it('blocks metadata/*.yml (short YAML extension, guarded alongside *.yaml)', () => {
      // #given a yaml file using the short .yml extension
      // #when the guard evaluates the PR
      // #then the edit IS blocked — metadata/*.{yaml,yml} are both auto-managed state
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['metadata/repos.yml'],
      })
      expect(result).toEqual({ok: false, blockedFiles: ['metadata/repos.yml']})
    })

    it('does not block metadata/*.ymlx (longer than the guarded extension)', () => {
      // #given a filename that merely starts with the guarded extension
      // #when the guard evaluates the PR
      // #then the edit is NOT blocked — the pattern is anchored at the end with $
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['metadata/repos.ymlx'],
      })
      expect(result).toEqual({ok: true})
    })

    it('does not block metadata/*.yam (short of the guarded extension by one character)', () => {
      // #given a filename missing the trailing "l" of either guarded extension
      // #when the guard evaluates the PR
      // #then the edit is NOT blocked — `ya?ml` requires the full "yaml" or "yml" spelling
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['metadata/repos.yam'],
      })
      expect(result).toEqual({ok: true})
    })

    it('does not block files named like the guarded ones but outside the guarded prefix', () => {
      // #given files with guard-lookalike names at other locations
      // #when the guard evaluates the PR
      // #then the edit is NOT blocked — anchored regexes only match the canonical prefixes
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['docs/knowledge/index.md', 'backup/metadata/repos.yaml', 'src/knowledge/wiki/x.md'],
      })
      expect(result).toEqual({ok: true})
    })

    it('does not block a wiki page path with an extra suffix after .md (trailing-anchor discrimination)', () => {
      // #given a path that starts with a real guarded wiki prefix but keeps going past ".md"
      // #when the guard evaluates the PR
      // #then the edit is NOT blocked — the pattern is anchored at the end with $
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['knowledge/wiki/topics/home-assistant.md.bak'],
      })
      expect(result).toEqual({ok: true})
    })

    it('does not block a wiki-shaped path embedded mid-string with a real subdir/file split (leading-anchor discrimination)', () => {
      // #given a full knowledge/wiki/<subdir>/<file>.md shape that does not start the path
      // #when the guard evaluates the PR
      // #then the edit is NOT blocked — the pattern is anchored at the start with ^
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['src/knowledge/wiki/topics/home-assistant.md'],
      })
      expect(result).toEqual({ok: true})
    })

    it('does not block knowledge/index.md with an extra suffix (trailing-anchor discrimination)', () => {
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['knowledge/index.md.bak'],
      })
      expect(result).toEqual({ok: true})
    })

    it('does not block knowledge/log.md with an extra suffix (trailing-anchor discrimination)', () => {
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['knowledge/log.md.bak'],
      })
      expect(result).toEqual({ok: true})
    })

    it('does not block knowledge/log.md embedded mid-string (leading-anchor discrimination)', () => {
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['src/knowledge/log.md'],
      })
      expect(result).toEqual({ok: true})
    })

    it('does not block knowledge/corrections.yaml with an extra suffix (trailing-anchor discrimination)', () => {
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: [`${CORRECTIONS_PATH}.bak`],
      })
      expect(result).toEqual({ok: true})
    })

    it('does not block knowledge/corrections.yaml embedded mid-string (leading-anchor discrimination)', () => {
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: [`src/${CORRECTIONS_PATH}`],
      })
      expect(result).toEqual({ok: true})
    })

    it('does not block metadata/repos.yaml with an extra suffix (trailing-anchor discrimination)', () => {
      const result = checkWikiAuthority({
        author: 'marcusrbrown',
        headRef: 'main',
        headRepo: THIS_REPO,
        baseRepo: THIS_REPO,
        files: ['metadata/repos.yaml.bak'],
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

  it('renders the blocked-file list as a `  - <path>` block joined by newlines, in order', () => {
    // #given two blocked files
    // #when the failure message is formatted
    // #then the rendered block matches the exact `-` prefix and newline join, not just substrings
    const msg = formatBlockMessage({ok: false, blockedFiles: ['metadata/repos.yaml', 'knowledge/index.md']})
    expect(msg).toContain('  - metadata/repos.yaml\n  - knowledge/index.md')
  })
})

describe('readPullRequestContext (base vs head repo)', () => {
  // A fork PR's head repo (the contributor's fork) is a DIFFERENT repository from the base
  // repo (this repository, where the PR was opened) — that distinction is exactly what makes
  // a fork PR's changed-file lookup resolvable at all: `fetchChangedFiles` must query the base
  // repo's API endpoint, never the fork's, since only the base repo has a `/pulls/{n}/files`
  // endpoint for this PR. `fullName` is documented as coming from `pull_request.base.repo`,
  // but nothing pinned that against an event payload where base and head actually differ until
  // now — every existing fixture used the same `fro-bot/.github` string for both.
  it('returns the BASE repo full_name, not the HEAD repo full_name, when a fork PR event has different values for each', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'check-wiki-authority-fork-pr-'))
    const eventPath = join(tmpDir, 'event.json')
    try {
      writeFileSync(
        eventPath,
        JSON.stringify({
          pull_request: {
            number: 7,
            user: {login: 'contributor'},
            head: {ref: 'feature/x', repo: {full_name: 'contributor-fork/.github'}},
            base: {repo: {full_name: 'fro-bot/.github'}},
          },
        }),
        'utf8',
      )

      const context = await readPullRequestContext(eventPath)

      expect(context.fullName).toBe('fro-bot/.github')
      expect(context.fullName).not.toBe('contributor-fork/.github')
    } finally {
      rmSync(tmpDir, {recursive: true, force: true})
    }
  })
})

describe('readPullRequestContext (head repo for the authority guard)', () => {
  it('returns the head repo full_name alongside the base repo full_name', async () => {
    const {eventPath, cleanup} = writeTempEvent('check-wiki-authority-head-repo-', {
      pull_request: {
        number: 7,
        user: {login: 'fro-bot[bot]'},
        head: {ref: 'data', repo: {full_name: 'fro-bot/.github'}},
        base: {repo: {full_name: 'fro-bot/.github'}},
      },
    })
    try {
      const context = await readPullRequestContext(eventPath)
      expect(context.headRepo).toBe('fro-bot/.github')
      expect(context.fullName).toBe('fro-bot/.github')
    } finally {
      cleanup()
    }
  })

  it('carries a fork head repo through unchanged, and the guard blocks a fork-origin data branch', async () => {
    const {eventPath, cleanup} = writeTempEvent('check-wiki-authority-fork-data-', {
      pull_request: {
        number: 7,
        user: {login: 'fro-bot'},
        head: {ref: 'data', repo: {full_name: 'contributor-fork/.github'}},
        base: {repo: {full_name: 'fro-bot/.github'}},
      },
    })
    try {
      const context = await readPullRequestContext(eventPath)
      expect(context.headRepo).toBe('contributor-fork/.github')
      const result = checkWikiAuthority({
        author: context.author,
        headRef: context.headRef,
        headRepo: context.headRepo,
        baseRepo: context.fullName ?? '',
        files: ['metadata/repos.yaml'],
      })
      expect(result).toEqual({ok: false, blockedFiles: ['metadata/repos.yaml']})
    } finally {
      cleanup()
    }
  })

  it('yields an undefined head repo (not a throw) when head.repo is null, as for a deleted fork', async () => {
    const {eventPath, cleanup} = writeTempEvent('check-wiki-authority-null-head-repo-', {
      pull_request: {
        number: 7,
        user: {login: 'fro-bot'},
        head: {ref: 'data', repo: null},
        base: {repo: {full_name: 'fro-bot/.github'}},
      },
    })
    try {
      const context = await readPullRequestContext(eventPath)
      expect(context.headRepo).toBeUndefined()
    } finally {
      cleanup()
    }
  })

  it('yields an undefined head repo when head.repo is absent from the payload', async () => {
    const {eventPath, cleanup} = writeTempEvent('check-wiki-authority-no-head-repo-', {
      pull_request: {
        number: 7,
        user: {login: 'fro-bot'},
        head: {ref: 'data'},
        base: {repo: {full_name: 'fro-bot/.github'}},
      },
    })
    try {
      const context = await readPullRequestContext(eventPath)
      expect(context.headRepo).toBeUndefined()
    } finally {
      cleanup()
    }
  })
})

describe('readPullRequestContext (optional-chaining discrimination)', () => {
  // Each field read (`pull_request?.number`, `pull_request?.user?.login`, `pull_request?.head?.ref`)
  // is a separate optional-chain node. `?.` is required by the enforced type
  // (`PullRequestEventPayload`'s `pull_request`, `user`, and `head` are all declared optional) --
  // removing any single `?.` turns a missing intermediate value into a thrown TypeError instead of
  // this function's own diagnostic Error, which each test below discriminates by asserting the
  // exact message.

  it('throws the missing pull_request.number diagnostic (not a raw TypeError) when pull_request itself is absent', async () => {
    const {eventPath, cleanup} = writeTempEvent('check-wiki-authority-no-pr-', {})
    try {
      await expect(readPullRequestContext(eventPath)).rejects.toThrow(
        /missing pull_request\.number or pull_request\.user\.login/,
      )
    } finally {
      cleanup()
    }
  })

  it('throws the missing pull_request.user.login diagnostic (not a raw TypeError) when user is null', async () => {
    const {eventPath, cleanup} = writeTempEvent('check-wiki-authority-null-user-', {
      pull_request: {number: 7, user: null, head: {ref: 'feature/x'}},
    })
    try {
      await expect(readPullRequestContext(eventPath)).rejects.toThrow(
        /missing pull_request\.number or pull_request\.user\.login/,
      )
    } finally {
      cleanup()
    }
  })

  it('throws the missing pull_request.head.ref diagnostic (not a raw TypeError) when head is null', async () => {
    const {eventPath, cleanup} = writeTempEvent('check-wiki-authority-null-head-', {
      pull_request: {number: 7, user: {login: 'marcusrbrown'}, head: null},
    })
    try {
      await expect(readPullRequestContext(eventPath)).rejects.toThrow(/missing pull_request\.head\.ref/)
    } finally {
      cleanup()
    }
  })

  it('throws the missing-number diagnostic when prNumber is present but not a number, with a valid author (isolates the prNumber operand)', async () => {
    // #given a payload where only the number field fails validation — author and head are valid
    // #when the number-check operand alone is forced false, the other operands must still fire
    const {eventPath, cleanup} = writeTempEvent('check-wiki-authority-bad-number-', {
      pull_request: {number: 'not-a-number', user: {login: 'marcusrbrown'}, head: {ref: 'feature/x'}},
    })
    try {
      await expect(readPullRequestContext(eventPath)).rejects.toThrow(
        /missing pull_request\.number or pull_request\.user\.login/,
      )
    } finally {
      cleanup()
    }
  })

  it("throws the missing-author diagnostic when author is the empty string, with a valid number (isolates the author==='' operand)", async () => {
    const {eventPath, cleanup} = writeTempEvent('check-wiki-authority-empty-author-', {
      pull_request: {number: 7, user: {login: ''}, head: {ref: 'feature/x'}},
    })
    try {
      await expect(readPullRequestContext(eventPath)).rejects.toThrow(
        /missing pull_request\.number or pull_request\.user\.login/,
      )
    } finally {
      cleanup()
    }
  })

  it('throws the missing headRef diagnostic when headRef is present but not a string (isolates the typeof headRef operand)', async () => {
    const {eventPath, cleanup} = writeTempEvent('check-wiki-authority-bad-headref-', {
      pull_request: {number: 7, user: {login: 'marcusrbrown'}, head: {ref: 123}},
    })
    try {
      await expect(readPullRequestContext(eventPath)).rejects.toThrow(/missing pull_request\.head\.ref/)
    } finally {
      cleanup()
    }
  })

  it("throws the missing headRef diagnostic when headRef is the empty string (isolates the headRef==='' operand)", async () => {
    const {eventPath, cleanup} = writeTempEvent('check-wiki-authority-empty-headref-', {
      pull_request: {number: 7, user: {login: 'marcusrbrown'}, head: {ref: ''}},
    })
    try {
      await expect(readPullRequestContext(eventPath)).rejects.toThrow(/missing pull_request\.head\.ref/)
    } finally {
      cleanup()
    }
  })

  it('resolves fullName as null (not a throw) when base.repo is absent — the repo?.full_name link is a live optional', async () => {
    // #given a payload with a valid pull_request but no base.repo at all
    // #when the repo?.full_name optional chain is exercised on an undefined repo
    // #then it short-circuits to null rather than throwing (proves the link is not dead code)
    const {eventPath, cleanup} = writeTempEvent('check-wiki-authority-no-base-repo-', {
      pull_request: {number: 7, user: {login: 'marcusrbrown'}, head: {ref: 'feature/x'}, base: {}},
    })
    try {
      const context = await readPullRequestContext(eventPath)
      expect(context.fullName).toBeNull()
    } finally {
      cleanup()
    }
  })

  it('resolves fullName as null (not the empty string) when base.repo.full_name is the empty string', async () => {
    const {eventPath, cleanup} = writeTempEvent('check-wiki-authority-empty-fullname-', {
      pull_request: {
        number: 7,
        user: {login: 'marcusrbrown'},
        head: {ref: 'feature/x'},
        base: {repo: {full_name: ''}},
      },
    })
    try {
      const context = await readPullRequestContext(eventPath)
      expect(context.fullName).toBeNull()
    } finally {
      cleanup()
    }
  })
})

describe('fetchChangedFiles (Fix #5 — paginated API)', () => {
  it('calls gh api --paginate with the correct endpoint and returns filenames', () => {
    // #given execFileSync returns a newline-separated list of filenames (as gh --paginate would)
    mockExecFileSync.mockReturnValue('scripts/foo.ts\nmetadata/repos.yaml\nknowledge/index.md\n')

    // #when fetchChangedFiles is called with prNumber and fullName
    const files = fetchChangedFiles(42, 'fro-bot/.github')

    // #then it uses gh api --paginate (not gh pr view) and returns all filenames
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'gh',
      ['api', '--paginate', '/repos/fro-bot/.github/pulls/42/files', '--jq', '.[].filename'],
      {encoding: 'utf8'},
    )
    expect(files).toEqual(['scripts/foo.ts', 'metadata/repos.yaml', 'knowledge/index.md'])
  })

  it('includes metadata/repos.yaml from a paginated response not on the first page (guard bypass prevented)', () => {
    // #given execFileSync returns filenames where metadata/repos.yaml appears later
    // (simulating it being beyond the first page of a large PR — --paginate merges it all)
    const paginatedOutput = [
      'scripts/a.ts',
      'scripts/b.ts',
      // ... imagine 300 files above, then:
      'metadata/repos.yaml',
    ].join('\n')
    mockExecFileSync.mockReturnValue(`${paginatedOutput}\n`)

    const files = fetchChangedFiles(99, 'fro-bot/.github')

    // #then metadata/repos.yaml is present in the result (not dropped by single-page limit)
    expect(files).toContain('metadata/repos.yaml')

    // #and a non-data-branch human author is correctly blocked
    const guardResult = checkWikiAuthority({
      author: 'marcusrbrown',
      headRef: 'feature/x',
      headRepo: THIS_REPO,
      baseRepo: THIS_REPO,
      files,
    })
    expect(guardResult).toEqual({ok: false, blockedFiles: ['metadata/repos.yaml']})
  })

  it('filters empty lines from the output', () => {
    // #given output with trailing newline (common from shell tools)
    mockExecFileSync.mockReturnValue('foo.ts\n\nbar.ts\n')

    const files = fetchChangedFiles(1, 'owner/repo')

    expect(files).toEqual(['foo.ts', 'bar.ts'])
  })
})

// Drives main() end to end for a Fro Bot PR on the `data` head so the head-repo / base-repo
// wiring (event payload -> checkWikiAuthority) is observable, not just the pure function.
async function runMainAsFroBot(options: {
  suffix: string
  headRepo: {full_name: string} | null
  base: {repo: {full_name: string}} | undefined
  mockedGh: string[]
}): Promise<{exited: boolean; stderr: string; stdout: string}> {
  const modulePath = new URL('./check-wiki-authority.ts', import.meta.url)
  const originalArgv = [...process.argv]
  const originalEventPath = process.env.GITHUB_EVENT_PATH
  const {eventPath, cleanup} = writeTempEvent(`check-wiki-authority-${options.suffix}-`, {
    pull_request: {
      number: 5,
      user: {login: 'fro-bot[bot]'},
      head: {ref: 'data', repo: options.headRepo},
      base: options.base,
    },
  })
  const stderrOutput: string[] = []
  const stdoutOutput: string[] = []
  vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
    stderrOutput.push(String(msg))
    return true
  })
  vi.spyOn(process.stdout, 'write').mockImplementation((msg: unknown) => {
    stdoutOutput.push(String(msg))
    return true
  })
  vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('process.exit called')
  })
  mockExecFileSync.mockReset()
  for (const value of options.mockedGh) mockExecFileSync.mockReturnValueOnce(value)

  process.env.GITHUB_EVENT_PATH = eventPath
  process.argv = [originalArgv[0] ?? 'node', modulePath.pathname]
  let exited = false
  try {
    await import(`${modulePath.href}?guard-test-${options.suffix}`)
  } catch (error: unknown) {
    if (!(error instanceof Error) || error.message !== 'process.exit called') throw error
    exited = true
  } finally {
    vi.restoreAllMocks()
    process.argv = originalArgv
    cleanup()
    if (originalEventPath === undefined) {
      delete process.env.GITHUB_EVENT_PATH
    } else {
      process.env.GITHUB_EVENT_PATH = originalEventPath
    }
  }
  return {exited, stderr: stderrOutput.join(''), stdout: stdoutOutput.join('')}
}

// ---------------------------------------------------------------------------
// CLI self-invoke guard (import.meta.url === file://<argv[1]>)
// ---------------------------------------------------------------------------

describe('CLI self-invoke guard (import.meta.url === file://<argv[1]>)', () => {
  // Every other test in this file imports the module without ever setting process.argv[1] to its
  // own path, so the `false` branch of every mutator variant here is trivially exercised (real
  // code and every mutant behave identically when the condition is never true) -- that is NOT
  // sufficient to kill the mutants; a genuine discriminating test must make the condition true for
  // the *real* code and observe main() actually run. Cache-busts the dynamic import (unique query
  // string) so the module's top-level code re-executes with the manipulated argv/env, rather than
  // returning the already-cached module instance from every earlier `import` in this file.

  // Several tests below call mockExecFileSync.mockReset() and then queue mockReturnValueOnce calls
  // for their own scenario, without restoring afterward — order-independent only if every leftover
  // queued return value is cleared before the next test runs.
  afterEach(() => {
    mockExecFileSync.mockReset()
  })

  it('exits 1 with the GITHUB_EVENT_PATH diagnostic when the env var is unset', async () => {
    const modulePath = new URL('./check-wiki-authority.ts', import.meta.url)
    const originalArgv = [...process.argv]
    const originalEventPath = process.env.GITHUB_EVENT_PATH

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    delete process.env.GITHUB_EVENT_PATH
    process.argv = [originalArgv[0] ?? 'node', modulePath.pathname]
    try {
      await expect(import(`${modulePath.href}?guard-test-no-event-path`)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(stderrOutput.join('')).toContain('GITHUB_EVENT_PATH not set')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      process.argv = originalArgv
      if (originalEventPath === undefined) {
        delete process.env.GITHUB_EVENT_PATH
      } else {
        process.env.GITHUB_EVENT_PATH = originalEventPath
      }
    }
  })

  it('exits 1 with the empty-string GITHUB_EVENT_PATH treated the same as unset', async () => {
    const modulePath = new URL('./check-wiki-authority.ts', import.meta.url)
    const originalArgv = [...process.argv]
    const originalEventPath = process.env.GITHUB_EVENT_PATH

    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.env.GITHUB_EVENT_PATH = ''
    process.argv = [originalArgv[0] ?? 'node', modulePath.pathname]
    try {
      await expect(import(`${modulePath.href}?guard-test-empty-event-path`)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      process.argv = originalArgv
      if (originalEventPath === undefined) {
        delete process.env.GITHUB_EVENT_PATH
      } else {
        process.env.GITHUB_EVENT_PATH = originalEventPath
      }
    }
  })

  it('invokes main() and writes the ok summary to stdout when the PR is allowed (fullName from event payload)', async () => {
    const modulePath = new URL('./check-wiki-authority.ts', import.meta.url)
    const originalArgv = [...process.argv]
    const originalEventPath = process.env.GITHUB_EVENT_PATH

    const {eventPath, cleanup} = writeTempEvent('check-wiki-authority-guard-ok-', {
      pull_request: {
        number: 42,
        user: {login: 'marcusrbrown'},
        head: {ref: 'feature/x'},
        base: {repo: {full_name: 'fro-bot/.github'}},
      },
    })

    const stdoutOutput: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((msg: unknown) => {
      stdoutOutput.push(String(msg))
      return true
    })
    const stderrSpyGuard = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    mockExecFileSync.mockReset()
    mockExecFileSync.mockReturnValueOnce('scripts/foo.ts\nREADME.md\n')

    process.env.GITHUB_EVENT_PATH = eventPath
    process.argv = [originalArgv[0] ?? 'node', modulePath.pathname]
    try {
      await import(`${modulePath.href}?guard-test-main-ok`)
      expect(exitSpy).not.toHaveBeenCalled()
      expect(stdoutOutput.join('')).toContain('check-wiki-authority: ok (author=marcusrbrown, files_checked=2)')
      expect(stderrSpyGuard).not.toHaveBeenCalled()
      // fullName came from the event payload — the gh repo view fallback must not have been called.
      expect(mockExecFileSync).toHaveBeenCalledTimes(1)
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'gh',
        ['api', '--paginate', '/repos/fro-bot/.github/pulls/42/files', '--jq', '.[].filename'],
        {encoding: 'utf8'},
      )
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      process.argv = originalArgv
      cleanup()
      if (originalEventPath === undefined) {
        delete process.env.GITHUB_EVENT_PATH
      } else {
        process.env.GITHUB_EVENT_PATH = originalEventPath
      }
    }
  })

  it('invokes main() and exits 1 with the block message on stderr when the PR is blocked', async () => {
    const modulePath = new URL('./check-wiki-authority.ts', import.meta.url)
    const originalArgv = [...process.argv]
    const originalEventPath = process.env.GITHUB_EVENT_PATH

    const {eventPath, cleanup} = writeTempEvent('check-wiki-authority-guard-blocked-', {
      pull_request: {
        number: 7,
        user: {login: 'marcusrbrown'},
        head: {ref: 'feature/x'},
        base: {repo: {full_name: 'fro-bot/.github'}},
      },
    })

    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    const stdoutSpyGuard = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    mockExecFileSync.mockReset()
    mockExecFileSync.mockReturnValueOnce('metadata/repos.yaml\n')

    process.env.GITHUB_EVENT_PATH = eventPath
    process.argv = [originalArgv[0] ?? 'node', modulePath.pathname]
    try {
      await expect(import(`${modulePath.href}?guard-test-main-blocked`)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(stderrOutput.join('')).toContain('metadata/repos.yaml')
      expect(stderrOutput.join('')).toContain('data')
      expect(stdoutSpyGuard).not.toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      process.argv = originalArgv
      cleanup()
      if (originalEventPath === undefined) {
        delete process.env.GITHUB_EVENT_PATH
      } else {
        process.env.GITHUB_EVENT_PATH = originalEventPath
      }
    }
  })

  it('main() blocks a Fro Bot data-branch PR whose head repo is a fork of the base repo', async () => {
    const result = await runMainAsFroBot({
      suffix: 'fork-data',
      headRepo: {full_name: 'contributor-fork/.github'},
      base: {repo: {full_name: 'fro-bot/.github'}},
      mockedGh: ['metadata/repos.yaml\n'],
    })
    expect(result.exited).toBe(true)
    expect(result.stderr).toContain('metadata/repos.yaml')
    expect(result.stdout).toBe('')
  })

  it('main() blocks a Fro Bot data-branch PR whose head repo was deleted (null head.repo)', async () => {
    const result = await runMainAsFroBot({
      suffix: 'null-head-repo',
      headRepo: null,
      base: {repo: {full_name: 'fro-bot/.github'}},
      mockedGh: ['metadata/repos.yaml\n'],
    })
    expect(result.exited).toBe(true)
    expect(result.stderr).toContain('metadata/repos.yaml')
  })

  it("main() allows this repository's own data-branch promotion PR", async () => {
    const result = await runMainAsFroBot({
      suffix: 'own-data',
      headRepo: {full_name: 'fro-bot/.github'},
      base: {repo: {full_name: 'fro-bot/.github'}},
      mockedGh: ['metadata/repos.yaml\nknowledge/index.md\n'],
    })
    expect(result.exited).toBe(false)
    expect(result.stdout).toContain('check-wiki-authority: ok (author=fro-bot[bot], files_checked=2)')
  })

  it('main() compares the head repo against the gh-resolved base repo when the payload omits base.repo', async () => {
    const same = await runMainAsFroBot({
      suffix: 'fallback-same',
      headRepo: {full_name: 'fro-bot/.github'},
      base: undefined,
      mockedGh: ['fro-bot/.github\n', 'metadata/repos.yaml\n'],
    })
    expect(same.exited).toBe(false)
    expect(same.stdout).toContain('check-wiki-authority: ok')

    const different = await runMainAsFroBot({
      suffix: 'fallback-different',
      headRepo: {full_name: 'contributor-fork/.github'},
      base: undefined,
      mockedGh: ['fro-bot/.github\n', 'metadata/repos.yaml\n'],
    })
    expect(different.exited).toBe(true)
    expect(different.stderr).toContain('metadata/repos.yaml')
  })

  it('falls back to `gh repo view` for fullName, trimmed, when the event payload omits base.repo.full_name', async () => {
    const modulePath = new URL('./check-wiki-authority.ts', import.meta.url)
    const originalArgv = [...process.argv]
    const originalEventPath = process.env.GITHUB_EVENT_PATH

    const {eventPath, cleanup} = writeTempEvent('check-wiki-authority-guard-fallback-', {
      pull_request: {
        number: 99,
        user: {login: 'marcusrbrown'},
        head: {ref: 'feature/x'},
      },
    })

    const stdoutOutput: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((msg: unknown) => {
      stdoutOutput.push(String(msg))
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    mockExecFileSync.mockReset()
    // Untrimmed, to prove `.trim()` actually runs on the fallback lookup's output.
    mockExecFileSync.mockReturnValueOnce('  fro-bot/.github  \n')
    mockExecFileSync.mockReturnValueOnce('README.md\n')

    process.env.GITHUB_EVENT_PATH = eventPath
    process.argv = [originalArgv[0] ?? 'node', modulePath.pathname]
    try {
      await import(`${modulePath.href}?guard-test-main-fallback`)
      expect(exitSpy).not.toHaveBeenCalled()
      expect(mockExecFileSync).toHaveBeenNthCalledWith(
        1,
        'gh',
        ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
        {encoding: 'utf8'},
      )
      expect(mockExecFileSync).toHaveBeenNthCalledWith(
        2,
        'gh',
        ['api', '--paginate', '/repos/fro-bot/.github/pulls/99/files', '--jq', '.[].filename'],
        {encoding: 'utf8'},
      )
      expect(stdoutOutput.join('')).toContain('check-wiki-authority: ok')
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      process.argv = originalArgv
      cleanup()
      if (originalEventPath === undefined) {
        delete process.env.GITHUB_EVENT_PATH
      } else {
        process.env.GITHUB_EVENT_PATH = originalEventPath
      }
    }
  })

  it("does NOT invoke main() when process.argv[1] does not match the module's own path (positive control)", async () => {
    const modulePath = new URL('./check-wiki-authority.ts', import.meta.url)
    const originalArgv = [...process.argv]

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.argv = [originalArgv[0] ?? 'node', '/some/unrelated/entrypoint.js']
    try {
      await import(`${modulePath.href}?guard-test-noop`)
      expect(exitSpy).not.toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      process.argv = originalArgv
    }
  })
})
