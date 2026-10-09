/**
 * Real-filesystem tests against a throwaway git repo: the drafted handoff is built from git
 * objects (staged blobs), never from working-tree paths, so a swapped file or directory cannot
 * change what ends up in the artifact.
 */

import {Buffer} from 'node:buffer'
import {execFile} from 'node:child_process'
import {access, chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {promisify} from 'node:util'

import {afterEach, describe, expect, it} from 'vitest'

import {buildDraftedHandoff} from './drafted-solutions-handoff-build.ts'
import {createGitRunner, DRAFTED_SOLUTIONS_HANDOFF_MAX_TOTAL_BYTES, type GitRunner} from './wiki-handoff-core.ts'

const execFileAsync = promisify(execFile)

const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async dir => rm(dir, {recursive: true, force: true})))
})

const EXISTING = 'docs/solutions/best-practices/existing.md'
const SECOND = 'docs/solutions/workflow-issues/second.md'

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync('git', args, {cwd})
}

async function writeIn(cwd: string, relativePath: string, content: string): Promise<void> {
  const dest = path.join(cwd, relativePath)
  await mkdir(path.dirname(dest), {recursive: true})
  await writeFile(dest, content)
}

/** A committed checkout with two tracked solution docs, plus a sibling file outside the repo. */
async function arrange() {
  const root = await mkdtemp(path.join(tmpdir(), 'drafted-handoff-build-test-'))
  tempDirs.push(root)
  const cwd = path.join(root, 'checkout')
  await mkdir(cwd, {recursive: true})
  await git(cwd, 'init', '-q', '-b', 'main')
  await git(cwd, 'config', 'user.email', 'test@example.test')
  await git(cwd, 'config', 'user.name', 'Test')
  await git(cwd, 'config', 'commit.gpgsign', 'false')
  await writeIn(cwd, EXISTING, '# existing\n')
  await writeIn(cwd, SECOND, '# second\n')
  await writeIn(cwd, 'README.md', '# readme\n')
  await git(cwd, 'add', '-A')
  await git(cwd, 'commit', '-q', '-m', 'seed')

  const outside = path.join(root, 'outside')
  await mkdir(outside, {recursive: true})
  await writeFile(path.join(outside, 'secret.md'), 'runner-readable secret\n')

  return {root, cwd, outside, outDir: path.join(root, 'handoff')}
}

type Arranged = Awaited<ReturnType<typeof arrange>>

async function build(arranged: Arranged, runGit?: GitRunner) {
  return buildDraftedHandoff({cwd: arranged.cwd, outDir: arranged.outDir, ...(runGit === undefined ? {} : {runGit})})
}

async function expectRejected(arranged: Arranged, pattern: RegExp, runGit?: GitRunner) {
  await expect(build(arranged, runGit)).rejects.toThrow(pattern)
  await expect(access(arranged.outDir)).rejects.toThrow()
}

describe('buildDraftedHandoff: accepted changes', () => {
  it('produces the right manifest and files for a regular new doc and a regular modified doc', async () => {
    const arranged = await arrange()
    await writeIn(arranged.cwd, 'docs/solutions/security-issues/new-doc-2026-10-09.md', '# new\n')
    await writeIn(arranged.cwd, EXISTING, '# existing, extended\n')

    const result = await build(arranged)

    expect(result).toStrictEqual({
      changed: [EXISTING, 'docs/solutions/security-issues/new-doc-2026-10-09.md'],
      deleted: [],
    })
    expect(JSON.parse(await readFile(path.join(arranged.outDir, 'manifest.json'), 'utf8'))).toStrictEqual(result)
    expect(await readFile(path.join(arranged.outDir, 'files', EXISTING), 'utf8')).toBe('# existing, extended\n')
    expect(
      await readFile(path.join(arranged.outDir, 'files/docs/solutions/security-issues/new-doc-2026-10-09.md'), 'utf8'),
    ).toBe('# new\n')
  })

  it('writes an empty manifest when the agent changed nothing', async () => {
    const arranged = await arrange()

    const result = await build(arranged)

    expect(result).toStrictEqual({changed: [], deleted: []})
    expect(JSON.parse(await readFile(path.join(arranged.outDir, 'manifest.json'), 'utf8'))).toStrictEqual(result)
  })

  it('ignores changes outside docs/solutions', async () => {
    const arranged = await arrange()
    await writeIn(arranged.cwd, 'README.md', '# edited\n')
    await writeIn(arranged.cwd, 'scripts/evil.ts', 'export {}\n')

    expect(await build(arranged)).toStrictEqual({changed: [], deleted: []})
  })

  it('keeps blob bytes exact, including non-UTF-8 content', async () => {
    const arranged = await arrange()
    const bytes = Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a])
    await writeFile(path.join(arranged.cwd, EXISTING), bytes)

    await build(arranged)

    expect(await readFile(path.join(arranged.outDir, 'files', EXISTING))).toStrictEqual(bytes)
  })
})

describe('buildDraftedHandoff: copies come from git objects, not working-tree paths', () => {
  it('a working-tree change after staging does not change the artifact bytes', async () => {
    const arranged = await arrange()
    await writeFile(path.join(arranged.cwd, EXISTING), '# staged content\n')
    const real = createGitRunner(arranged.cwd)
    const tampering: GitRunner = async (args, options) => {
      const output = await real(args, options)
      if (args[0] === 'add') await writeFile(path.join(arranged.cwd, EXISTING), '# TAMPERED after staging\n')
      return output
    }

    await build(arranged, tampering)

    expect(await readFile(path.join(arranged.outDir, 'files', EXISTING), 'utf8')).toBe('# staged content\n')
  })

  it('swapping the staged file for a symlink after staging does not leak the link target', async () => {
    const arranged = await arrange()
    await writeFile(path.join(arranged.cwd, EXISTING), '# staged content\n')
    const real = createGitRunner(arranged.cwd)
    const swapping: GitRunner = async (args, options) => {
      const output = await real(args, options)
      if (args[0] === 'add') {
        await rm(path.join(arranged.cwd, EXISTING))
        await symlink(path.join(arranged.outside, 'secret.md'), path.join(arranged.cwd, EXISTING))
      }
      return output
    }

    await build(arranged, swapping)

    expect(await readFile(path.join(arranged.outDir, 'files', EXISTING), 'utf8')).toBe('# staged content\n')
  })

  it('swapping the parent directory for a symlink after staging does not leak the link target', async () => {
    const arranged = await arrange()
    await writeFile(path.join(arranged.cwd, EXISTING), '# staged content\n')
    await writeFile(path.join(arranged.outside, 'existing.md'), 'runner-readable secret\n')
    const real = createGitRunner(arranged.cwd)
    const swapping: GitRunner = async (args, options) => {
      const output = await real(args, options)
      if (args[0] === 'add') {
        await rm(path.join(arranged.cwd, 'docs/solutions/best-practices'), {recursive: true})
        await symlink(arranged.outside, path.join(arranged.cwd, 'docs/solutions/best-practices'))
      }
      return output
    }

    await build(arranged, swapping)

    expect(await readFile(path.join(arranged.outDir, 'files', EXISTING), 'utf8')).toBe('# staged content\n')
  })
})

describe('buildDraftedHandoff: rejected changes (nothing is produced)', () => {
  it('rejects a symlinked doc', async () => {
    const arranged = await arrange()
    await symlink(
      path.join(arranged.outside, 'secret.md'),
      path.join(arranged.cwd, 'docs/solutions/best-practices/leak.md'),
    )
    await writeIn(arranged.cwd, 'docs/solutions/best-practices/ok.md', '# ok\n')

    await expectRejected(arranged, /120000/)
  })

  it('rejects a symlink replacing a tracked doc', async () => {
    const arranged = await arrange()
    await rm(path.join(arranged.cwd, EXISTING))
    await symlink(path.join(arranged.outside, 'secret.md'), path.join(arranged.cwd, EXISTING))

    await expectRejected(arranged, /120000/)
  })

  it('rejects a symlinked parent directory that replaces a tracked category directory', async () => {
    const arranged = await arrange()
    await writeFile(path.join(arranged.outside, 'existing.md'), 'runner-readable secret\n')
    await rm(path.join(arranged.cwd, 'docs/solutions/best-practices'), {recursive: true})
    await symlink(arranged.outside, path.join(arranged.cwd, 'docs/solutions/best-practices'))

    await expectRejected(arranged, /./)
  })

  it('rejects a new symlinked category directory', async () => {
    const arranged = await arrange()
    await symlink(arranged.outside, path.join(arranged.cwd, 'docs/solutions/runtime-errors'))

    await expectRejected(arranged, /./)
  })

  it('rejects an executable-mode doc', async () => {
    const arranged = await arrange()
    await writeIn(arranged.cwd, 'docs/solutions/best-practices/run-me.md', '# run\n')
    await chmod(path.join(arranged.cwd, 'docs/solutions/best-practices/run-me.md'), 0o755)

    await expectRejected(arranged, /100644/)
  })

  it('rejects a gitlink (nested repository) under docs/solutions', async () => {
    const arranged = await arrange()
    const nested = path.join(arranged.cwd, 'docs/solutions/best-practices/nested-repo')
    await mkdir(nested, {recursive: true})
    await git(nested, 'init', '-q')
    await git(nested, 'config', 'user.email', 'test@example.test')
    await git(nested, 'config', 'user.name', 'Test')
    await writeFile(path.join(nested, 'a.md'), '# a\n')
    await git(nested, 'add', '-A')
    await git(nested, 'commit', '-q', '-m', 'nested')

    await expectRejected(arranged, /./)
  })

  it('rejects a deletion', async () => {
    const arranged = await arrange()
    await rm(path.join(arranged.cwd, EXISTING))

    await expectRejected(arranged, /deletions are not allowed/)
  })

  it('rejects a rename (reported as a deletion plus an addition)', async () => {
    const arranged = await arrange()
    await git(arranged.cwd, 'mv', EXISTING, 'docs/solutions/best-practices/renamed.md')

    await expectRejected(arranged, /deletions are not allowed/)
  })

  it.each([
    ['an uncategorised doc', 'docs/solutions/x.md'],
    ['an unknown category', 'docs/solutions/new-category/x.md'],
    ['a non-markdown file', 'docs/solutions/best-practices/x.yaml'],
    ['a nested file', 'docs/solutions/best-practices/nested/x.md'],
  ])('rejects %s', async (_label: string, relativePath: string) => {
    const arranged = await arrange()
    await writeIn(arranged.cwd, 'docs/solutions/best-practices/ok.md', '# ok\n')
    await writeIn(arranged.cwd, relativePath, '# x\n')

    await expectRejected(arranged, /outside the allowed/)
  })

  it('rejects a file name containing a backslash', async () => {
    const arranged = await arrange()
    await writeIn(arranged.cwd, String.raw`docs/solutions/best-practices\sneaky.md`, '# x\n')

    await expectRejected(arranged, /backslash/)
  })

  it('rejects a bundle over the drafted size cap', async () => {
    const arranged = await arrange()
    await writeFile(
      path.join(arranged.cwd, 'docs/solutions/best-practices/big.md'),
      Buffer.alloc(DRAFTED_SOLUTIONS_HANDOFF_MAX_TOTAL_BYTES + 1, 0x61),
    )

    await expectRejected(arranged, /size cap/)
  })

  it('fails hard when git cannot stage (not a git repository)', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'drafted-handoff-build-nogit-'))
    tempDirs.push(root)

    await expect(buildDraftedHandoff({cwd: root, outDir: path.join(root, 'out')})).rejects.toThrow(/git add failed/)
    await expect(access(path.join(root, 'out'))).rejects.toThrow()
  })
})
