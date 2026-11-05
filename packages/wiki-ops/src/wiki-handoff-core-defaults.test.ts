import {Buffer} from 'node:buffer'
import {execFileSync} from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import process from 'node:process'

import {afterAll, beforeAll, describe, expect, it} from 'vitest'

import {
  buildHandoffFromGitIndex,
  buildWikiHandoff,
  captureWikiBaseline,
  createGitRunner,
  draftedSolutionsHandoffPolicy,
  validateAndApplyWikiHandoff,
  wikiHandoffPolicy,
  WikiHandoffValidationError,
} from './wiki-handoff-core.ts'

/**
 * These tests run the module's real defaults: `createGitRunner`, the real `fs` seams, `defaultExists` and
 * `defaultHashContents`. Every directory, repository, link and file below is created under one
 * test-owned temp root, and every call is given a path under it as both cwd and target; nothing here
 * names the checkout. Fixtures only ever hold benign relative paths, so a regression that skips a check
 * still writes inside the root. The root is removed when the file finishes.
 */
const root = mkdtempSync(path.join(tmpdir(), 'wiki-handoff-core-defaults-'))
const secretPath = path.join(root, 'secret.txt')

const scrubbedGitEnv = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_COMMON_DIR',
  'GIT_PREFIX',
]
const savedEnv = new Map<string, string | undefined>()

beforeAll(() => {
  // A hook or a user's global config must not change what git does inside the fixture repositories.
  for (const name of [...scrubbedGitEnv, 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM']) {
    savedEnv.set(name, process.env[name])
    delete process.env[name]
  }
  process.env.GIT_CONFIG_GLOBAL = '/dev/null'
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  writeFileSync(secretPath, 'runner-readable secret\n')
})

afterAll(() => {
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  rmSync(root, {recursive: true, force: true})
})

let counter = 0

function freshDir(label: string): string {
  counter += 1
  const dir = path.join(root, `${label}-${counter}`)
  mkdirSync(dir, {recursive: true})
  return dir
}

function writeUnder(base: string, relativePath: string, content: string | Buffer): void {
  const target = path.join(base, relativePath)
  mkdirSync(path.dirname(target), {recursive: true})
  writeFileSync(target, content)
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], {
    cwd,
    encoding: 'utf8',
  })
}

function initRepo(label: string): string {
  const repo = freshDir(label)
  git(repo, 'init', '--quiet')
  return repo
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error: unknown) {
    return error
  }
  throw new Error('expected the promise to reject')
}

function nul(...records: string[]): string {
  return records.length === 0 ? '' : `${records.join('\0')}\0`
}

// sha256 of the five bytes "hello".
const HELLO_SHA256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'

describe('createGitRunner against a real repository', () => {
  it('runs git in the given directory and returns stdout as bytes', async () => {
    const repo = initRepo('runner')

    const stdout = await createGitRunner(repo)(['rev-parse', '--show-toplevel'], {maxBuffer: 4096})

    expect(Buffer.isBuffer(stdout)).toBe(true)
    expect(stdout.toString('utf8').trim()).toBe(realpathSync(repo))
  })

  it('passes the argv through unchanged', async () => {
    const repo = initRepo('runner-args')

    const stdout = await createGitRunner(repo)(['--version'], {maxBuffer: 4096})

    expect(stdout.toString('utf8')).toMatch(/^git version /)
  })

  it('returns blob bytes unchanged, including bytes that are not valid utf8', async () => {
    const repo = initRepo('runner-bytes')
    const bytes = Buffer.from([0xff, 0x00, 0xfe, 0x41, 0x80])
    writeUnder(repo, 'blob.bin', bytes)
    const sha = git(repo, 'hash-object', '-w', 'blob.bin').trim()

    const stdout = await createGitRunner(repo)(['cat-file', 'blob', sha], {maxBuffer: 4096})

    expect(stdout.equals(bytes)).toBe(true)
  })

  it('rejects with the max-buffer code when stdout outgrows the limit', async () => {
    const repo = initRepo('runner-max')

    const error = await rejectionOf(createGitRunner(repo)(['--version'], {maxBuffer: 3}))

    expect((error as {code?: unknown}).code).toBe('ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
  })

  it('rejects when git exits non-zero', async () => {
    const repo = initRepo('runner-exit')

    const error = await rejectionOf(createGitRunner(repo)(['rev-parse', '--verify', 'no-such-ref'], {maxBuffer: 4096}))

    expect(error).toBeInstanceOf(Error)
  })
})

describe('buildHandoffFromGitIndex with the real git runner', () => {
  it('stages the pathspec, reads blobs from git objects and writes the artifact', async () => {
    const repo = initRepo('index-build')
    writeUnder(repo, 'docs/solutions/best-practices/new.md', '# new\n')
    writeUnder(repo, 'docs/solutions/runtime-errors/two.md', 'two\n')
    writeUnder(repo, 'docs/plans/outside-the-pathspec.md', 'not staged\n')
    const outDir = path.join(freshDir('index-build-out'), 'handoff')

    const result = await buildHandoffFromGitIndex({
      cwd: repo,
      outDir,
      pathspec: 'docs/solutions',
      policy: draftedSolutionsHandoffPolicy(),
    })

    expect(result).toStrictEqual({
      changed: ['docs/solutions/best-practices/new.md', 'docs/solutions/runtime-errors/two.md'],
      deleted: [],
    })
    expect(readFileSync(path.join(outDir, 'files/docs/solutions/best-practices/new.md'), 'utf8')).toBe('# new\n')
    expect(readFileSync(path.join(outDir, 'files/docs/solutions/runtime-errors/two.md'), 'utf8')).toBe('two\n')
    expect(existsSync(path.join(outDir, 'files/docs/plans'))).toBe(false)
    expect(readFileSync(path.join(outDir, 'manifest.json'), 'utf8')).toBe(
      '{\n  "changed": [\n    "docs/solutions/best-practices/new.md",\n    "docs/solutions/runtime-errors/two.md"\n  ],\n  "deleted": []\n}\n',
    )
  })

  it('reports an addition, a modification and a deletion under the wiki policy', async () => {
    const repo = initRepo('index-wiki')
    writeUnder(repo, 'knowledge/log.md', 'log\n')
    writeUnder(repo, 'knowledge/wiki/repos/a.md', 'before\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '--quiet', '-m', 'seed')
    writeUnder(repo, 'knowledge/wiki/repos/a.md', 'after\n')
    writeUnder(repo, 'knowledge/wiki/repos/b.md', 'added\n')
    unlinkSync(path.join(repo, 'knowledge/log.md'))
    const outDir = path.join(freshDir('index-wiki-out'), 'handoff')

    const result = await buildHandoffFromGitIndex({
      cwd: repo,
      outDir,
      pathspec: 'knowledge',
      policy: wikiHandoffPolicy(),
    })

    expect(result).toStrictEqual({
      changed: ['knowledge/wiki/repos/a.md', 'knowledge/wiki/repos/b.md'],
      deleted: ['knowledge/log.md'],
    })
    expect(readFileSync(path.join(outDir, 'files/knowledge/wiki/repos/a.md'), 'utf8')).toBe('after\n')
  })

  it('refuses a symlink at an allowed path and creates no artifact', async () => {
    const repo = initRepo('index-symlink')
    mkdirSync(path.join(repo, 'docs/solutions/best-practices'), {recursive: true})
    symlinkSync(secretPath, path.join(repo, 'docs/solutions/best-practices/link.md'))
    const outDir = path.join(freshDir('index-symlink-out'), 'handoff')

    const error = await rejectionOf(
      buildHandoffFromGitIndex({
        cwd: repo,
        outDir,
        pathspec: 'docs/solutions',
        policy: draftedSolutionsHandoffPolicy(),
      }),
    )

    expect(error).toBeInstanceOf(WikiHandoffValidationError)
    expect((error as Error).message).toBe(
      'wiki-handoff-build: docs/solutions/best-practices/link.md has mode 120000; only regular files (100644) are allowed',
    )
    expect(existsSync(outDir)).toBe(false)
  })

  it('refuses an executable file and creates no artifact', async () => {
    const repo = initRepo('index-exec')
    writeUnder(repo, 'docs/solutions/best-practices/run.md', '#!/bin/sh\n')
    chmodSync(path.join(repo, 'docs/solutions/best-practices/run.md'), 0o755)
    const outDir = path.join(freshDir('index-exec-out'), 'handoff')

    const error = await rejectionOf(
      buildHandoffFromGitIndex({
        cwd: repo,
        outDir,
        pathspec: 'docs/solutions',
        policy: draftedSolutionsHandoffPolicy(),
      }),
    )

    expect((error as Error).message).toBe(
      'wiki-handoff-build: docs/solutions/best-practices/run.md has mode 100755; only regular files (100644) are allowed',
    )
    expect(existsSync(outDir)).toBe(false)
  })

  it('wraps a failing git command, naming it', async () => {
    const repo = initRepo('index-fail')
    const outDir = path.join(freshDir('index-fail-out'), 'handoff')

    const error = await rejectionOf(
      buildHandoffFromGitIndex({
        cwd: repo,
        outDir,
        pathspec: 'no-such-pathspec-for-the-handoff-test',
        policy: draftedSolutionsHandoffPolicy(),
      }),
    )

    expect(error).toBeInstanceOf(WikiHandoffValidationError)
    expect((error as Error).message).toMatch(/^wiki-handoff-build: git add failed: /)
    expect(existsSync(outDir)).toBe(false)
  })
})

describe('the status-based wiki build with the real filesystem defaults', () => {
  it('hashes with sha256 and records the baseline as two-space JSON', async () => {
    const cwd = freshDir('baseline-cwd')
    writeUnder(cwd, 'knowledge/wiki/repos/a.md', 'hello')
    const baselinePath = path.join(freshDir('baseline-out'), 'baseline.json')

    const manifest = await captureWikiBaseline({
      cwd,
      baselinePath,
      runGitStatus: async () => nul('?? knowledge/wiki/repos/a.md', ' D knowledge/log.md'),
    })

    expect(manifest).toStrictEqual({files: {'knowledge/wiki/repos/a.md': HELLO_SHA256}, deleted: ['knowledge/log.md']})
    expect(readFileSync(baselinePath, 'utf8')).toBe(
      `{\n  "files": {\n    "knowledge/wiki/repos/a.md": "${HELLO_SHA256}"\n  },\n  "deleted": [\n    "knowledge/log.md"\n  ]\n}\n`,
    )
  })

  it('scopes to the baseline: drops unchanged pages, keeps edits, finds a vanished page, and copies the edit', async () => {
    const cwd = freshDir('scope-cwd')
    for (const name of ['a', 'b', 'c', 'd']) writeUnder(cwd, `knowledge/wiki/repos/${name}.md`, 'hello')
    const baselinePath = path.join(freshDir('scope-baseline'), 'baseline.json')
    await captureWikiBaseline({
      cwd,
      baselinePath,
      runGitStatus: async () => nul(...['a', 'b', 'c', 'd'].map(name => `?? knowledge/wiki/repos/${name}.md`)),
    })
    writeUnder(cwd, 'knowledge/wiki/repos/b.md', 'edited by the agent')
    unlinkSync(path.join(cwd, 'knowledge/wiki/repos/c.md'))
    const outDir = path.join(freshDir('scope-out'), 'handoff')

    const result = await buildWikiHandoff({
      cwd,
      outDir,
      baselinePath,
      runGitStatus: async () => nul('?? knowledge/wiki/repos/a.md', '?? knowledge/wiki/repos/b.md'),
    })

    expect(result).toStrictEqual({changed: ['knowledge/wiki/repos/b.md'], deleted: ['knowledge/wiki/repos/c.md']})
    expect(readFileSync(path.join(outDir, 'files/knowledge/wiki/repos/b.md'), 'utf8')).toBe('edited by the agent')
    expect(existsSync(path.join(outDir, 'files/knowledge/wiki/repos/a.md'))).toBe(false)
    expect(readFileSync(path.join(outDir, 'manifest.json'), 'utf8')).toBe(
      '{\n  "changed": [\n    "knowledge/wiki/repos/b.md"\n  ],\n  "deleted": [\n    "knowledge/wiki/repos/c.md"\n  ]\n}\n',
    )
  })

  it('refuses a symlink at an allowed path and creates no artifact', async () => {
    const cwd = freshDir('link-cwd')
    mkdirSync(path.join(cwd, 'knowledge/wiki/repos'), {recursive: true})
    symlinkSync(secretPath, path.join(cwd, 'knowledge/wiki/repos/link.md'))
    const outDir = path.join(freshDir('link-out'), 'handoff')

    const error = await rejectionOf(
      buildWikiHandoff({cwd, outDir, runGitStatus: async () => nul('?? knowledge/wiki/repos/link.md')}),
    )

    expect((error as Error).message).toBe('wiki-handoff-build: refusing symlink source: knowledge/wiki/repos/link.md')
    expect(existsSync(outDir)).toBe(false)
  })

  it('refuses a directory at an allowed path and creates no artifact', async () => {
    const cwd = freshDir('dir-cwd')
    mkdirSync(path.join(cwd, 'knowledge/wiki/repos/dir.md'), {recursive: true})
    const outDir = path.join(freshDir('dir-out'), 'handoff')

    const error = await rejectionOf(
      buildWikiHandoff({cwd, outDir, runGitStatus: async () => nul('?? knowledge/wiki/repos/dir.md')}),
    )

    expect((error as Error).message).toBe(
      'wiki-handoff-build: source is not a regular file: knowledge/wiki/repos/dir.md',
    )
    expect(existsSync(outDir)).toBe(false)
  })

  it('lets a missing source through the check so the copy fails with ENOENT', async () => {
    const cwd = freshDir('missing-cwd')
    const outDir = path.join(freshDir('missing-out'), 'handoff')

    const error = await rejectionOf(
      buildWikiHandoff({cwd, outDir, runGitStatus: async () => nul('?? knowledge/wiki/repos/missing.md')}),
    )

    expect((error as {code?: unknown}).code).toBe('ENOENT')
  })
})

function artifact(manifest: unknown, files: Record<string, string>): string {
  const handoffDir = freshDir('handoff')
  writeUnder(handoffDir, 'manifest.json', JSON.stringify(manifest))
  mkdirSync(path.join(handoffDir, 'files'), {recursive: true})
  for (const [relativePath, content] of Object.entries(files))
    writeUnder(path.join(handoffDir, 'files'), relativePath, content)
  return handoffDir
}

describe('the validating apply with the real filesystem defaults', () => {
  it('writes changed pages, removes deleted ones even when already gone, and leaves the shared files alone', async () => {
    const workspaceDir = freshDir('workspace')
    writeUnder(workspaceDir, 'knowledge/wiki/repos/old.md', 'old')
    writeUnder(workspaceDir, 'knowledge/log.md', 'writer log')
    const handoffDir = artifact(
      {
        changed: ['knowledge/wiki/repos/a.md', 'knowledge/log.md'],
        deleted: ['knowledge/wiki/repos/old.md', 'knowledge/wiki/repos/never-existed.md'],
      },
      {'knowledge/wiki/repos/a.md': 'applied page', 'knowledge/log.md': 'agent log'},
    )

    const result = await validateAndApplyWikiHandoff({handoffDir, workspaceDir})

    expect(result).toStrictEqual({
      applied: ['knowledge/wiki/repos/a.md'],
      deleted: ['knowledge/wiki/repos/old.md', 'knowledge/wiki/repos/never-existed.md'],
      skipped: ['knowledge/log.md'],
    })
    expect(readFileSync(path.join(workspaceDir, 'knowledge/wiki/repos/a.md'), 'utf8')).toBe('applied page')
    expect(existsSync(path.join(workspaceDir, 'knowledge/wiki/repos/old.md'))).toBe(false)
    expect(readFileSync(path.join(workspaceDir, 'knowledge/log.md'), 'utf8')).toBe('writer log')
  })

  it('refuses a symlinked entry and writes nothing', async () => {
    const workspaceDir = freshDir('workspace')
    const handoffDir = artifact({changed: ['knowledge/wiki/repos/link.md'], deleted: []}, {})
    mkdirSync(path.join(handoffDir, 'files/knowledge/wiki/repos'), {recursive: true})
    symlinkSync(secretPath, path.join(handoffDir, 'files/knowledge/wiki/repos/link.md'))

    const error = await rejectionOf(validateAndApplyWikiHandoff({handoffDir, workspaceDir}))

    expect((error as Error).message).toBe('refusing symlink in wiki handoff: knowledge/wiki/repos/link.md')
    expect(existsSync(path.join(workspaceDir, 'knowledge'))).toBe(false)
  })

  it('refuses a directory where a file is listed and writes nothing', async () => {
    const workspaceDir = freshDir('workspace')
    const handoffDir = artifact({changed: ['knowledge/wiki/repos/dir.md'], deleted: []}, {})
    mkdirSync(path.join(handoffDir, 'files/knowledge/wiki/repos/dir.md'), {recursive: true})

    const error = await rejectionOf(validateAndApplyWikiHandoff({handoffDir, workspaceDir}))

    expect((error as Error).message).toBe('wiki handoff entry is not a regular file: knowledge/wiki/repos/dir.md')
    expect(existsSync(path.join(workspaceDir, 'knowledge'))).toBe(false)
  })

  it('refuses an unexpected top-level entry before reading the manifest', async () => {
    const workspaceDir = freshDir('workspace')
    const handoffDir = artifact({changed: [], deleted: []}, {})
    writeUnder(handoffDir, 'metadata.json', '{}')

    const error = await rejectionOf(validateAndApplyWikiHandoff({handoffDir, workspaceDir}))

    expect((error as Error).message).toBe('wiki handoff artifact contains unexpected top-level entries: metadata.json')
  })

  it('reports a missing manifest with its path', async () => {
    const workspaceDir = freshDir('workspace')
    const handoffDir = freshDir('handoff-empty')

    const error = await rejectionOf(validateAndApplyWikiHandoff({handoffDir, workspaceDir}))

    expect(error).toBeInstanceOf(WikiHandoffValidationError)
    expect((error as Error).message).toContain(`failed to read ${path.join(handoffDir, 'manifest.json')}: `)
  })
})
