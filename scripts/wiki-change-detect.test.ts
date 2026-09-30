import type {Dirent} from 'node:fs'

import {Buffer} from 'node:buffer'
import {execFileSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import process from 'node:process'
import {afterEach, describe, expect, it} from 'vitest'

import {
  captureWikiScopeSnapshot,
  computeWikiChangeHash,
  hashWikiScopeSnapshot,
  type WikiChangeDetectEntry,
} from './wiki-change-detect-core.ts'

const scriptPath = resolve(import.meta.dirname, 'wiki-change-detect.ts')
const WIKI_SCOPE_PATHS = ['knowledge/index.md', 'knowledge/log.md', 'knowledge/wiki']

/** Reproduces this repo's own `.gitignore` rules for the noise the detector must exclude. */
const REPO_GITIGNORE_RULES = '.DS_Store\n*.swp\n*.swo\n'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir !== undefined) rmSync(dir, {recursive: true, force: true})
  }
})

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {cwd, encoding: 'utf8'})
}

/** A real git repo (not mocked) with the scoped knowledge/ layout and this repo's own `.gitignore` rules already committed. */
function makeRepo(): string {
  const dir = makeTempDir('wiki-change-detect-')
  git(dir, ['init', '-q', '-b', 'main'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])
  mkdirSync(join(dir, 'knowledge', 'wiki', 'repos'), {recursive: true})
  writeFileSync(join(dir, 'knowledge', 'index.md'), '# Index\n')
  writeFileSync(join(dir, 'knowledge', 'log.md'), '# Log\n')
  writeFileSync(join(dir, 'README.md'), '# Out of scope\n')
  writeFileSync(join(dir, '.gitignore'), REPO_GITIGNORE_RULES)
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'init'])
  return dir
}

function writeFileWithDir(absolutePath: string, contents: string): void {
  mkdirSync(dirname(absolutePath), {recursive: true})
  writeFileSync(absolutePath, contents)
}

/** Appends to the repo's `.gitignore` without needing a commit — `check-ignore --no-index` reads the worktree file directly. */
function appendGitignore(dir: string, rule: string): void {
  writeFileSync(join(dir, '.gitignore'), `${REPO_GITIGNORE_RULES}${rule}\n`)
}

async function hashOf(cwd: string): Promise<string> {
  return computeWikiChangeHash({cwd, scopePaths: WIKI_SCOPE_PATHS})
}

async function snapshotOf(cwd: string): Promise<WikiChangeDetectEntry[]> {
  return captureWikiScopeSnapshot({cwd, scopePaths: WIKI_SCOPE_PATHS})
}

/** Guards against a vacuous pass: fails loudly if the git command silently no-op'd. */
function assertPorcelainContains(cwd: string, expectedPath: string): void {
  const status = git(cwd, ['status', '--porcelain=v1', '--', '.'])
  expect(status, `expected git status to mention ${expectedPath}, got: ${JSON.stringify(status)}`).toContain(
    expectedPath,
  )
}

describe('hashWikiScopeSnapshot (pure)', () => {
  it('is a deterministic function of its input', () => {
    const entries: WikiChangeDetectEntry[] = [
      {relativePath: 'a.md', hash: 'h1'},
      {relativePath: 'b.md', hash: 'h2'},
    ]
    expect(hashWikiScopeSnapshot(entries)).toBe(hashWikiScopeSnapshot([...entries]))
  })

  it('differs when a path or a hash differs', () => {
    const base = [{relativePath: 'a.md', hash: 'h1'}]
    expect(hashWikiScopeSnapshot(base)).not.toBe(hashWikiScopeSnapshot([{relativePath: 'a.md', hash: 'h2'}]))
    expect(hashWikiScopeSnapshot(base)).not.toBe(hashWikiScopeSnapshot([{relativePath: 'b.md', hash: 'h1'}]))
  })

  it('is unambiguous across a path/hash boundary shift (NUL-delimited, not naive concatenation)', () => {
    const a = hashWikiScopeSnapshot([{relativePath: 'ab', hash: 'c'}])
    const b = hashWikiScopeSnapshot([{relativePath: 'a', hash: 'bc'}])
    expect(a).not.toBe(b)
  })
})

describe('computeWikiChangeHash (real git repos, content-only, eligibility-filtered)', () => {
  describe('changed=false: index-only operations never flip the hash', () => {
    it('clean baseline with no operation', async () => {
      const dir = makeRepo()
      const baseline = await hashOf(dir)
      expect(await hashOf(dir)).toBe(baseline)
    })

    it('an edit that existed at baseline, left unchanged', async () => {
      const dir = makeRepo()
      writeFileSync(join(dir, 'knowledge', 'log.md'), '# Log\n\nAlready edited before baseline\n')
      const baseline = await hashOf(dir)
      expect(await hashOf(dir)).toBe(baseline)
    })

    it("Fro Bot's case: that same pre-baseline edit, staged with git add and no further content change", async () => {
      const dir = makeRepo()
      writeFileSync(join(dir, 'knowledge', 'log.md'), '# Log\n\nAlready edited before baseline\n')
      const beforeSnapshot = await snapshotOf(dir)
      const baseline = await hashOf(dir)

      git(dir, ['add', 'knowledge/log.md'])
      assertPorcelainContains(dir, 'knowledge/log.md')

      const afterSnapshot = await snapshotOf(dir)
      expect(afterSnapshot).toStrictEqual(beforeSnapshot)
      expect(await hashOf(dir)).toBe(baseline)
    })

    it('a clean tracked file removed from the index with git rm --cached (bytes kept on disk)', async () => {
      const dir = makeRepo()
      const baseline = await hashOf(dir)

      git(dir, ['rm', '--cached', 'knowledge/log.md'])
      assertPorcelainContains(dir, 'knowledge/log.md')
      expect(readFileSync(join(dir, 'knowledge', 'log.md'), 'utf8')).toBe('# Log\n')

      expect(await hashOf(dir)).toBe(baseline)
    })

    it('a file already modified at baseline, then git rm --cached -f (bytes kept on disk)', async () => {
      const dir = makeRepo()
      writeFileSync(join(dir, 'knowledge', 'log.md'), '# Log\n\nAlready edited before baseline\n')
      const baseline = await hashOf(dir)

      git(dir, ['rm', '--cached', '-f', 'knowledge/log.md'])
      assertPorcelainContains(dir, 'knowledge/log.md')
      expect(readFileSync(join(dir, 'knowledge', 'log.md'), 'utf8')).toBe('# Log\n\nAlready edited before baseline\n')

      expect(await hashOf(dir)).toBe(baseline)
    })

    it('a file untracked at baseline, then git add -N (intent-to-add, no content staged)', async () => {
      const dir = makeRepo()
      writeFileWithDir(join(dir, 'knowledge', 'wiki', 'repos', 'new-repo.md'), '# New\n')
      const baseline = await hashOf(dir)

      git(dir, ['add', '-N', 'knowledge/wiki/repos/new-repo.md'])
      assertPorcelainContains(dir, 'knowledge/wiki/repos/new-repo.md')

      expect(await hashOf(dir)).toBe(baseline)
    })

    it('a file untracked at baseline, then a normal git add with no content edit', async () => {
      const dir = makeRepo()
      writeFileWithDir(join(dir, 'knowledge', 'wiki', 'repos', 'new-repo.md'), '# New\n')
      const baseline = await hashOf(dir)

      git(dir, ['add', 'knowledge/wiki/repos/new-repo.md'])
      assertPorcelainContains(dir, 'knowledge/wiki/repos/new-repo.md')

      expect(await hashOf(dir)).toBe(baseline)
    })

    it('a file absent at baseline stays absent despite an index-wide git add -A', async () => {
      const dir = makeRepo()
      const baseline = await hashOf(dir)

      git(dir, ['add', '-A'])
      const status = git(dir, ['status', '--porcelain=v1'])
      expect(status.trim()).toBe('')

      expect(await hashOf(dir)).toBe(baseline)
    })

    it('an edit followed by exact restoration of the baseline bytes', async () => {
      const dir = makeRepo()
      const baseline = await hashOf(dir)

      writeFileSync(join(dir, 'knowledge', 'log.md'), '# Log\n\nTemporary\n')
      expect(await hashOf(dir)).not.toBe(baseline)

      writeFileSync(join(dir, 'knowledge', 'log.md'), '# Log\n')
      expect(await hashOf(dir)).toBe(baseline)
    })

    it('is unchanged for edits outside the scoped paths', async () => {
      const dir = makeRepo()
      const baseline = await hashOf(dir)
      writeFileSync(join(dir, 'README.md'), '# Out of scope, edited\n')
      expect(await hashOf(dir)).toBe(baseline)
    })
  })

  describe('changed=false: ineligible content never counts (allowlist + git check-ignore)', () => {
    it.each([
      ['.swp', 'knowledge/wiki/repos/notes.md.swp'],
      ['.swo', 'knowledge/wiki/repos/notes.md.swo'],
      ['.DS_Store', 'knowledge/wiki/.DS_Store'],
    ] as const)('creating, editing, then deleting a %s file never registers', async (_label, relativePath) => {
      const dir = makeRepo()
      const absolutePath = join(dir, relativePath)
      const baseline = await hashOf(dir)

      writeFileWithDir(absolutePath, 'noise\n')
      expect(await hashOf(dir)).toBe(baseline)

      writeFileSync(absolutePath, 'more noise\n')
      expect(await hashOf(dir)).toBe(baseline)

      rmSync(absolutePath)
      expect(await hashOf(dir)).toBe(baseline)
    })

    it('a non-ignored .txt under knowledge/wiki never registers (not allowlisted)', async () => {
      const dir = makeRepo()
      const baseline = await hashOf(dir)
      writeFileWithDir(join(dir, 'knowledge', 'wiki', 'repos', 'notes.txt'), 'plain text\n')
      expect(await hashOf(dir)).toBe(baseline)
    })

    it('an ignored .md never registers, even though it would otherwise be allowlisted', async () => {
      const dir = makeRepo()
      appendGitignore(dir, 'knowledge/wiki/repos/ignored.md')
      const targetPath = join(dir, 'knowledge', 'wiki', 'repos', 'ignored.md')
      writeFileSync(targetPath, '# Ignored but allowlisted-shaped\n')
      const status = git(dir, ['status', '--porcelain=v1', '--ignored', '--', 'knowledge/wiki/repos/ignored.md'])
      expect(status).toContain('!!')

      const baseline = await hashOf(dir)
      writeFileSync(targetPath, '# Edited, still ignored\n')
      expect(await hashOf(dir)).toBe(baseline)
    })

    it('an ignored .md inside an ignored directory never registers', async () => {
      const dir = makeRepo()
      appendGitignore(dir, 'knowledge/wiki/drafts/')
      const targetPath = join(dir, 'knowledge', 'wiki', 'drafts', 'note.md')
      writeFileWithDir(targetPath, '# Draft\n')
      const status = git(dir, ['status', '--porcelain=v1', '--ignored', '--', 'knowledge/wiki/drafts/note.md'])
      expect(status).toContain('!!')

      const baseline = await hashOf(dir)
      writeFileSync(targetPath, '# Draft, edited\n')
      expect(await hashOf(dir)).toBe(baseline)
    })

    it.each([
      ['force-added to the index', (dir: string, relativePath: string) => git(dir, ['add', '-f', relativePath])],
      [
        'force-added, then removed from the index with rm --cached',
        (dir: string, relativePath: string) => {
          git(dir, ['add', '-f', relativePath])
          git(dir, ['rm', '--cached', relativePath])
        },
      ],
    ] as const)('an ignore-matching file, %s, stays excluded (bytes on disk unchanged)', async (_label, indexOp) => {
      const dir = makeRepo()
      const relativePath = 'knowledge/wiki/repos/legacy.md'
      appendGitignore(dir, relativePath)
      writeFileSync(join(dir, relativePath), '# Legacy\n')

      const baseline = await hashOf(dir)
      indexOp(dir, relativePath)
      expect(await hashOf(dir)).toBe(baseline)
    })

    it('editing a tracked .md that matches an ignore pattern never registers (the conservative --no-index policy)', async () => {
      const dir = makeRepo()
      const relativePath = 'knowledge/wiki/repos/legacy-tracked.md'
      const absolutePath = join(dir, relativePath)
      writeFileSync(absolutePath, '# Legacy tracked\n')
      git(dir, ['add', relativePath])
      git(dir, ['commit', '-q', '-m', 'add legacy tracked page'])

      // The ignore rule arrives after the file is already tracked and committed.
      appendGitignore(dir, relativePath)
      const status = git(dir, ['status', '--porcelain=v1', '--ignored', '--', relativePath])
      // `--no-index` excludes it from detection regardless of what plain `git status`
      // says about an already-tracked path (git itself would NOT normally hide a
      // tracked file here) — that divergence is exactly the conservative policy.
      expect(status).toBe('')

      const baseline = await hashOf(dir)
      writeFileSync(absolutePath, '# Legacy tracked, edited\n')
      expect(await hashOf(dir)).toBe(baseline)
    })

    it('an ignore check that finds no matches still lets capture succeed', async () => {
      const dir = makeRepo()
      await expect(snapshotOf(dir)).resolves.not.toThrow()
      const snapshot = await snapshotOf(dir)
      expect(snapshot.map(entry => entry.relativePath).sort()).toStrictEqual(['knowledge/index.md', 'knowledge/log.md'])
    })
  })

  describe('changed=true: real content, path-set, or rename changes on eligible content', () => {
    it('a tracked content edit after baseline, left unstaged', async () => {
      const dir = makeRepo()
      const baseline = await hashOf(dir)
      writeFileSync(join(dir, 'knowledge', 'log.md'), '# Log\n\nNew entry\n')
      expect(await hashOf(dir)).not.toBe(baseline)
    })

    it('a tracked content edit after baseline, staged', async () => {
      const dir = makeRepo()
      const baseline = await hashOf(dir)
      writeFileSync(join(dir, 'knowledge', 'log.md'), '# Log\n\nNew entry\n')
      git(dir, ['add', 'knowledge/log.md'])
      expect(await hashOf(dir)).not.toBe(baseline)
    })

    it('an edit to a file that was untracked at baseline', async () => {
      const dir = makeRepo()
      const untrackedPath = join(dir, 'knowledge', 'wiki', 'repos', 'marcusrbrown-bar.md')
      writeFileSync(untrackedPath, '# Bar\n')
      const baseline = await hashOf(dir)
      writeFileSync(untrackedPath, '# Bar\n\nEdited\n')
      expect(await hashOf(dir)).not.toBe(baseline)
    })

    it.each([
      ['left untracked', (_dir: string) => {}],
      ['staged', (dir: string) => git(dir, ['add', 'knowledge/wiki/repos/new-repo.md'])],
      ['added with add -N', (dir: string) => git(dir, ['add', '-N', 'knowledge/wiki/repos/new-repo.md'])],
    ] as const)('a new file after baseline, %s', async (_label, indexOp) => {
      const dir = makeRepo()
      const baseline = await hashOf(dir)
      writeFileWithDir(join(dir, 'knowledge', 'wiki', 'repos', 'new-repo.md'), '# New\n')
      indexOp(dir)
      expect(await hashOf(dir)).not.toBe(baseline)
    })

    it('an existing file removed from the worktree, left unstaged', async () => {
      const dir = makeRepo()
      const baseline = await hashOf(dir)
      rmSync(join(dir, 'knowledge', 'log.md'))
      expect(await hashOf(dir)).not.toBe(baseline)
    })

    it('an existing file removed from the worktree, then staged with git add -A', async () => {
      const dir = makeRepo()
      const baseline = await hashOf(dir)
      rmSync(join(dir, 'knowledge', 'log.md'))
      git(dir, ['add', '-A'])
      assertPorcelainContains(dir, 'knowledge/log.md')
      expect(await hashOf(dir)).not.toBe(baseline)
    })

    it('a file untracked at baseline, then removed', async () => {
      const dir = makeRepo()
      const untrackedPath = join(dir, 'knowledge', 'wiki', 'repos', 'marcusrbrown-bar.md')
      writeFileSync(untrackedPath, '# Bar\n')
      const baseline = await hashOf(dir)
      rmSync(untrackedPath)
      expect(await hashOf(dir)).not.toBe(baseline)
    })

    it('a rename wholly within knowledge/wiki/, left unstaged (plain filesystem rename)', async () => {
      const dir = makeRepo()
      writeFileWithDir(join(dir, 'knowledge', 'wiki', 'repos', 'old-name.md'), '# Repo page\n')
      const baseline = await hashOf(dir)
      const fromPath = join(dir, 'knowledge', 'wiki', 'repos', 'old-name.md')
      const toPath = join(dir, 'knowledge', 'wiki', 'repos', 'new-name.md')
      writeFileSync(toPath, readFileSync(fromPath))
      rmSync(fromPath)
      expect(await hashOf(dir)).not.toBe(baseline)
    })

    it('a rename wholly within knowledge/wiki/, staged with git mv', async () => {
      const dir = makeRepo()
      writeFileWithDir(join(dir, 'knowledge', 'wiki', 'repos', 'old-name.md'), '# Repo page\n')
      git(dir, ['add', 'knowledge/wiki/repos/old-name.md'])
      git(dir, ['commit', '-q', '-m', 'add old-name page'])
      const baseline = await hashOf(dir)

      git(dir, ['mv', 'knowledge/wiki/repos/old-name.md', 'knowledge/wiki/repos/new-name.md'])
      assertPorcelainContains(dir, 'knowledge/wiki/repos/new-name.md')

      expect(await hashOf(dir)).not.toBe(baseline)
    })

    it('an edit that existed at baseline, later restored to HEAD content (not baseline content)', async () => {
      const dir = makeRepo()
      writeFileSync(join(dir, 'knowledge', 'log.md'), '# Log\n\nAlready edited before baseline\n')
      const baseline = await hashOf(dir)

      git(dir, ['checkout', '--', 'knowledge/log.md'])
      expect(readFileSync(join(dir, 'knowledge', 'log.md'), 'utf8')).toBe('# Log\n')

      expect(await hashOf(dir)).not.toBe(baseline)
    })

    it('ignored noise plus a valid .md edit still registers as changed', async () => {
      const dir = makeRepo()
      const baseline = await hashOf(dir)

      writeFileWithDir(join(dir, 'knowledge', 'wiki', 'repos', 'scratch.md.swp'), 'noise\n')
      writeFileSync(join(dir, 'knowledge', 'log.md'), '# Log\n\nReal ingest happened.\n')

      expect(await hashOf(dir)).not.toBe(baseline)
    })

    it('a negation pattern makes a .md eligible, then editing it registers as changed', async () => {
      const dir = makeRepo()
      appendGitignore(dir, 'knowledge/wiki/repos/*.md\n!knowledge/wiki/repos/keep.md')
      const keepPath = join(dir, 'knowledge', 'wiki', 'repos', 'keep.md')
      writeFileSync(keepPath, '# Kept by negation\n')
      // Sanity: the plain rule (without negation) really does ignore siblings, but the
      // negated path is not ignored.
      writeFileSync(join(dir, 'knowledge', 'wiki', 'repos', 'other.md'), '# Not kept\n')
      const otherStatus = git(dir, ['status', '--porcelain=v1', '--ignored', '--', 'knowledge/wiki/repos/other.md'])
      const keepStatus = git(dir, ['status', '--porcelain=v1', '--ignored', '--', 'knowledge/wiki/repos/keep.md'])
      expect(otherStatus).toContain('!!')
      expect(keepStatus).not.toContain('!!')

      const baseline = await hashOf(dir)
      writeFileSync(keepPath, '# Kept by negation, edited\n')
      expect(await hashOf(dir)).not.toBe(baseline)
    })
  })

  describe('determinism', () => {
    it('handles a path with a space and non-ASCII characters', async () => {
      const dir = makeRepo()
      const baseline = await hashOf(dir)
      writeFileWithDir(join(dir, 'knowledge', 'wiki', 'repos', 'café repo ☃.md'), '# Snowman\n')
      expect(await hashOf(dir)).not.toBe(baseline)
    })

    it('handles a filename containing a literal newline byte', async () => {
      const dir = makeRepo()
      const baseline = await hashOf(dir)
      writeFileWithDir(join(dir, 'knowledge', 'wiki', 'repos', 'weird\nname.md'), '# Weird\n')
      expect(await hashOf(dir)).not.toBe(baseline)
    })

    it('is independent of filesystem enumeration/creation order', async () => {
      const names = ['aaa.md', 'zzz.md', 'mmm.md']
      const dirA = makeRepo()
      const dirB = makeRepo()
      for (const name of names) {
        writeFileWithDir(join(dirA, 'knowledge', 'wiki', 'repos', name), `# ${name}\n`)
      }
      for (const name of [...names].reverse()) {
        writeFileWithDir(join(dirB, 'knowledge', 'wiki', 'repos', name), `# ${name}\n`)
      }
      expect(await hashOf(dirA)).toBe(await hashOf(dirB))
    })
  })

  describe('fail-closed: symlinks, dangling links, non-regular entries, and mid-capture races', () => {
    it('rejects a symlinked file inside scope', async () => {
      const dir = makeRepo()
      const targetPath = join(dir, 'knowledge', 'wiki', 'target.md')
      writeFileSync(targetPath, '# Target\n')
      symlinkSync(targetPath, join(dir, 'knowledge', 'wiki', 'link.md'))
      await expect(hashOf(dir)).rejects.toThrow(/symlink/)
    })

    it('rejects a symlinked ancestor directory inside scope', async () => {
      const dir = makeRepo()
      const realDir = join(dir, 'real-repos')
      mkdirSync(realDir, {recursive: true})
      writeFileSync(join(realDir, 'a.md'), '# A\n')
      symlinkSync(realDir, join(dir, 'knowledge', 'wiki', 'repos-link'), 'dir')
      await expect(hashOf(dir)).rejects.toThrow(/symlink/)
    })

    it('rejects a dangling symlink the same way as a live one', async () => {
      const dir = makeRepo()
      symlinkSync(join(dir, 'does-not-exist.md'), join(dir, 'knowledge', 'wiki', 'dangling.md'))
      await expect(hashOf(dir)).rejects.toThrow(/symlink/)
    })

    it('rejects a non-regular entry (a named pipe) inside scope', async () => {
      const dir = makeRepo()
      const fifoPath = join(dir, 'knowledge', 'wiki', 'pipe')
      execFileSync('mkfifo', [fifoPath])
      await expect(hashOf(dir)).rejects.toThrow(/non-regular/)
    })

    it('fails closed when a file disappears between listing and reading (mid-capture race)', async () => {
      await expect(
        captureWikiScopeSnapshot({
          cwd: '/fake',
          scopePaths: ['knowledge/wiki'],
          lstatImpl: async (p: string) => {
            if (p === '/fake/knowledge/wiki') {
              return {isSymbolicLink: () => false, isDirectory: () => true, isFile: () => false}
            }
            if (p === '/fake/knowledge/wiki/gone.md') {
              return {isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true}
            }
            throw Object.assign(new Error('ENOENT'), {code: 'ENOENT'})
          },
          readdirImpl: async (p: string) =>
            p === '/fake/knowledge/wiki' ? ([{name: 'gone.md'}] as unknown as Dirent[]) : [],
          readFileImpl: async () => {
            throw Object.assign(new Error('ENOENT: no such file or directory'), {code: 'ENOENT'})
          },
          checkIgnoreRunnerImpl: async () => ({stdout: '', exitCode: 1}),
        }),
      ).rejects.toThrow(/failed to read/)
    })

    it('propagates an unexpected enumeration error rather than treating the directory as empty', async () => {
      await expect(
        captureWikiScopeSnapshot({
          cwd: '/fake',
          scopePaths: ['scope'],
          lstatImpl: async () => ({isSymbolicLink: () => false, isDirectory: () => true, isFile: () => false}),
          readdirImpl: async () => {
            throw new Error('EACCES: permission denied')
          },
          readFileImpl: async () => Buffer.from(''),
        }),
      ).rejects.toThrow(/failed to enumerate/)
    })

    it('a missing scope root is absent, not an error', async () => {
      const dir = makeTempDir('wiki-change-detect-empty-')
      const snapshot = await snapshotOf(dir)
      expect(snapshot).toStrictEqual([])
    })
  })

  describe('fail-closed: git check-ignore subprocess failures and malformed output', () => {
    it('fails closed when the check-ignore subprocess throws (e.g. git not found)', async () => {
      const dir = makeRepo()
      await expect(
        captureWikiScopeSnapshot({
          cwd: dir,
          scopePaths: WIKI_SCOPE_PATHS,
          checkIgnoreRunnerImpl: async () => {
            throw new Error('spawn git ENOENT')
          },
        }),
      ).rejects.toThrow(/git check-ignore failed/)
    })

    it('fails closed on an unexpected exit status (e.g. a fatal git error, status 128)', async () => {
      const dir = makeRepo()
      await expect(
        captureWikiScopeSnapshot({
          cwd: dir,
          scopePaths: WIKI_SCOPE_PATHS,
          checkIgnoreRunnerImpl: async () => ({stdout: '', exitCode: 128}),
        }),
      ).rejects.toThrow(/unexpected status 128/)
    })

    it('fails closed on malformed output: a reported path outside the candidate set', async () => {
      const dir = makeRepo()
      await expect(
        captureWikiScopeSnapshot({
          cwd: dir,
          scopePaths: WIKI_SCOPE_PATHS,
          checkIgnoreRunnerImpl: async () => ({stdout: 'not-a-real-candidate.md\0', exitCode: 0}),
        }),
      ).rejects.toThrow(/outside the candidate set/)
    })

    it('never reads a subprocess failure as "nothing ignored" — a positive case still fails, not silently passes', async () => {
      const dir = makeRepo()
      writeFileSync(join(dir, 'knowledge', 'log.md'), '# Log\n\nNew entry\n')
      await expect(
        computeWikiChangeHash({
          cwd: dir,
          scopePaths: WIKI_SCOPE_PATHS,
          checkIgnoreRunnerImpl: async () => ({stdout: '', exitCode: 2}),
        }),
      ).rejects.toThrow(/unexpected status 2/)
    })
  })
})

interface CliResult {
  status: number
  stdout: string
  stderr: string
}

function runCli(args: string[], cwd: string, env: Record<string, string>): CliResult {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, ...args], {
      cwd,
      env: {...process.env, ...env},
      encoding: 'utf8',
    })
    return {status: 0, stdout, stderr: ''}
  } catch (error) {
    const failure = error as {status?: number; stdout?: string; stderr?: string}
    return {status: failure.status ?? 1, stdout: String(failure.stdout ?? ''), stderr: String(failure.stderr ?? '')}
  }
}

function githubOutputPath(dir: string): string {
  return join(dir, 'github-output')
}

describe('wiki-change-detect.ts CLI', () => {
  it('baseline mode writes exactly one hash=<sha256> line to GITHUB_OUTPUT', () => {
    const dir = makeRepo()
    const outputPath = githubOutputPath(dir)
    const result = runCli(['baseline'], dir, {GITHUB_OUTPUT: outputPath})
    expect(result.status).toBe(0)
    const output = readFileSync(outputPath, 'utf8')
    expect(output).toMatch(/^hash=[0-9a-f]{64}\n$/)
    expect(output.split('\n').filter(Boolean)).toHaveLength(1)
  })

  it('detect mode writes changed=false when nothing changed since the fed baseline hash', () => {
    const dir = makeRepo()
    const baselineOutput = githubOutputPath(dir)
    runCli(['baseline'], dir, {GITHUB_OUTPUT: baselineOutput})
    const baselineHash = readFileSync(baselineOutput, 'utf8').trim().replace('hash=', '')

    const detectOutput = join(dir, 'github-output-detect')
    const result = runCli(['detect'], dir, {GITHUB_OUTPUT: detectOutput, WIKI_CHANGE_BASELINE_HASH: baselineHash})
    expect(result.status).toBe(0)
    expect(readFileSync(detectOutput, 'utf8')).toBe('changed=false\n')
  })

  it('detect mode writes changed=true after a tracked edit', () => {
    const dir = makeRepo()
    const baselineOutput = githubOutputPath(dir)
    runCli(['baseline'], dir, {GITHUB_OUTPUT: baselineOutput})
    const baselineHash = readFileSync(baselineOutput, 'utf8').trim().replace('hash=', '')

    writeFileSync(join(dir, 'knowledge', 'log.md'), '# Log\n\nNew entry\n')

    const detectOutput = join(dir, 'github-output-detect')
    const result = runCli(['detect'], dir, {GITHUB_OUTPUT: detectOutput, WIKI_CHANGE_BASELINE_HASH: baselineHash})
    expect(result.status).toBe(0)
    expect(readFileSync(detectOutput, 'utf8')).toBe('changed=true\n')
  })

  it('detect mode writes changed=true when only a new untracked repo page appeared', () => {
    const dir = makeRepo()
    const baselineOutput = githubOutputPath(dir)
    runCli(['baseline'], dir, {GITHUB_OUTPUT: baselineOutput})
    const baselineHash = readFileSync(baselineOutput, 'utf8').trim().replace('hash=', '')

    writeFileWithDir(join(dir, 'knowledge', 'wiki', 'repos', 'marcusrbrown-foo.md'), '# Foo\n')

    const detectOutput = join(dir, 'github-output-detect')
    const result = runCli(['detect'], dir, {GITHUB_OUTPUT: detectOutput, WIKI_CHANGE_BASELINE_HASH: baselineHash})
    expect(result.status).toBe(0)
    expect(readFileSync(detectOutput, 'utf8')).toBe('changed=true\n')
  })

  it('detect mode writes changed=false when the only new content is a .swp file (real CLI, real gitignore)', () => {
    const dir = makeRepo()
    const baselineOutput = githubOutputPath(dir)
    runCli(['baseline'], dir, {GITHUB_OUTPUT: baselineOutput})
    const baselineHash = readFileSync(baselineOutput, 'utf8').trim().replace('hash=', '')

    writeFileWithDir(join(dir, 'knowledge', 'wiki', 'repos', 'page.md.swp'), 'swap noise\n')

    const detectOutput = join(dir, 'github-output-detect')
    const result = runCli(['detect'], dir, {GITHUB_OUTPUT: detectOutput, WIKI_CHANGE_BASELINE_HASH: baselineHash})
    expect(result.status).toBe(0)
    expect(readFileSync(detectOutput, 'utf8')).toBe('changed=false\n')
  })

  it("Fro Bot's case end-to-end through the real CLI: staging a pre-baseline edit reports changed=false", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, 'knowledge', 'log.md'), '# Log\n\nAlready edited before baseline\n')
    const baselineOutput = githubOutputPath(dir)
    runCli(['baseline'], dir, {GITHUB_OUTPUT: baselineOutput})
    const baselineHash = readFileSync(baselineOutput, 'utf8').trim().replace('hash=', '')

    git(dir, ['add', 'knowledge/log.md'])

    const detectOutput = join(dir, 'github-output-detect')
    const result = runCli(['detect'], dir, {GITHUB_OUTPUT: detectOutput, WIKI_CHANGE_BASELINE_HASH: baselineHash})
    expect(result.status).toBe(0)
    expect(readFileSync(detectOutput, 'utf8')).toBe('changed=false\n')
  })

  it('fails non-zero and writes nothing when run outside a git repository', () => {
    const dir = makeTempDir('wiki-change-detect-non-git-')
    const outputPath = githubOutputPath(dir)
    const result = runCli(['baseline'], dir, {GITHUB_OUTPUT: outputPath})
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('::error::wiki-change-detect:')
    expect(result.stderr).toContain('not inside a git work tree')
    expect(() => readFileSync(outputPath, 'utf8')).toThrow(/ENOENT/)
  })

  it('fails non-zero and writes no changed=true when the baseline hash is missing in detect mode', () => {
    const dir = makeRepo()
    const detectOutput = githubOutputPath(dir)
    const result = runCli(['detect'], dir, {GITHUB_OUTPUT: detectOutput})
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('WIKI_CHANGE_BASELINE_HASH is required')
    expect(() => readFileSync(detectOutput, 'utf8')).toThrow(/ENOENT/)
  })

  it('fails non-zero and writes no changed=true when the baseline hash is empty in detect mode', () => {
    const dir = makeRepo()
    const detectOutput = githubOutputPath(dir)
    const result = runCli(['detect'], dir, {GITHUB_OUTPUT: detectOutput, WIKI_CHANGE_BASELINE_HASH: ''})
    expect(result.status).not.toBe(0)
    expect(() => readFileSync(detectOutput, 'utf8')).toThrow(/ENOENT/)
  })

  it('fails non-zero and writes no changed=true when the baseline hash is malformed in detect mode', () => {
    const dir = makeRepo()
    const detectOutput = githubOutputPath(dir)
    const result = runCli(['detect'], dir, {
      GITHUB_OUTPUT: detectOutput,
      WIKI_CHANGE_BASELINE_HASH: 'not-a-valid-hash',
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('must be a 64-character lowercase hex sha256 digest')
    expect(() => readFileSync(detectOutput, 'utf8')).toThrow(/ENOENT/)
  })

  it('fails non-zero on an invalid mode', () => {
    const dir = makeRepo()
    const outputPath = githubOutputPath(dir)
    const result = runCli(['bogus'], dir, {GITHUB_OUTPUT: outputPath})
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('mode must be "baseline" or "detect"')
  })

  it('fails non-zero with no env at all (no GITHUB_OUTPUT)', () => {
    const dir = makeRepo()
    expect(() =>
      execFileSync(process.execPath, [scriptPath, 'baseline'], {
        cwd: dir,
        env: {PATH: process.env.PATH ?? ''},
        encoding: 'utf8',
      }),
    ).toThrow()
  })

  it('a large scoped file (a few MiB) no longer fails baseline — content hashing never shells out to git diff', () => {
    const dir = makeRepo()
    // Commit the initial content so a real `git diff` against HEAD is meaningful, then
    // rewrite it before capturing the baseline: a full-file diff of a ~2 MiB rewrite is
    // large enough to exceed the old 1 MiB execFile maxBuffer default many times over,
    // while staying well under the 5 MiB wiki-handoff artifact cap for a single file.
    const targetPath = join(dir, 'knowledge', 'wiki', 'repos', 'big.md')
    const originalContent = `${'a'.repeat(2 * 1024 * 1024)}\n`
    writeFileWithDir(targetPath, originalContent)
    git(dir, ['add', 'knowledge/wiki/repos/big.md'])
    git(dir, ['commit', '-q', '-m', 'add big.md'])

    const rewrittenContent = `${'b'.repeat(2 * 1024 * 1024)}\n`
    writeFileSync(targetPath, rewrittenContent)

    const diff = execFileSync('git', ['diff', '--no-ext-diff', '--', 'knowledge/wiki/repos/big.md'], {
      cwd: dir,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
    expect(diff.length).toBeGreaterThan(1024 * 1024)

    const baselineOutput = githubOutputPath(dir)
    const baselineResult = runCli(['baseline'], dir, {GITHUB_OUTPUT: baselineOutput})
    expect(baselineResult.status).toBe(0)
    const baselineHash = readFileSync(baselineOutput, 'utf8').trim().replace('hash=', '')

    const unchangedOutput = join(dir, 'github-output-unchanged')
    const unchangedResult = runCli(['detect'], dir, {
      GITHUB_OUTPUT: unchangedOutput,
      WIKI_CHANGE_BASELINE_HASH: baselineHash,
    })
    expect(unchangedResult.status).toBe(0)
    expect(readFileSync(unchangedOutput, 'utf8')).toBe('changed=false\n')

    writeFileSync(targetPath, `${'c'.repeat(2 * 1024 * 1024)}\n`)
    const changedOutput = join(dir, 'github-output-changed')
    const changedResult = runCli(['detect'], dir, {
      GITHUB_OUTPUT: changedOutput,
      WIKI_CHANGE_BASELINE_HASH: baselineHash,
    })
    expect(changedResult.status).toBe(0)
    expect(readFileSync(changedOutput, 'utf8')).toBe('changed=true\n')
  })
})
