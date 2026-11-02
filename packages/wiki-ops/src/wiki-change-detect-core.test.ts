/**
 * Mutation-targeted tests for the scope walk: the seams are injected so each error shape and ordering is
 * pinned, and two tests run the real filesystem and real `git check-ignore` in a test-owned temp
 * repository for the defaults. `wiki-change-detect.test.ts` covers the CLI around it.
 */

import type {Dirent} from 'node:fs'
import {Buffer} from 'node:buffer'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {afterEach, describe, expect, it} from 'vitest'
import {
  captureWikiScopeSnapshot,
  hashWikiScopeSnapshot,
  type WikiChangeDetectCheckIgnoreRunnerFn,
} from './wiki-change-detect-core.ts'

const dir = (name: string) => ({name}) as Dirent
const directory = {isSymbolicLink: () => false, isDirectory: () => true, isFile: () => false}
const file = {isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true}
const noneIgnored: WikiChangeDetectCheckIgnoreRunnerFn = async () => ({stdout: '', exitCode: 1})

/** A tree of `knowledge/wiki/<names>` regular files, served through the injected seams. */
function seams(names: string[], overrides: Partial<Parameters<typeof captureWikiScopeSnapshot>[0]> = {}) {
  return {
    cwd: '/virtual',
    scopePaths: ['knowledge/wiki'],
    lstatImpl: async (absolutePath: string) => (absolutePath.endsWith('wiki') ? directory : file),
    readdirImpl: async () => names.map(dir),
    readFileImpl: async (absolutePath: string) => Buffer.from(absolutePath),
    hashImpl: (contents: Buffer) => contents.toString(),
    checkIgnoreRunnerImpl: noneIgnored,
    ...overrides,
  }
}

describe('ordering', () => {
  it('sorts the snapshot by path in UTF-16 code unit order, whatever order the directory lists', async () => {
    const snapshot = await captureWikiScopeSnapshot(seams(['c.md', 'a.md', 'B.md', 'b.md']))
    expect(snapshot.map(entry => entry.relativePath)).toEqual([
      'knowledge/wiki/B.md',
      'knowledge/wiki/a.md',
      'knowledge/wiki/b.md',
      'knowledge/wiki/c.md',
    ])
  })
})

describe('the stat of a scope root and of a walked entry', () => {
  const failingLstat = (error: unknown) => async (absolutePath: string) => {
    if (absolutePath.endsWith('/wiki')) throw error
    return file
  }

  it('skips a scope root that does not exist, whether the error is an Error or a plain object', async () => {
    const withCode = Object.assign(new Error('gone'), {code: 'ENOENT'})
    await expect(captureWikiScopeSnapshot(seams([], {lstatImpl: failingLstat(withCode)}))).resolves.toEqual([])
    await expect(captureWikiScopeSnapshot(seams([], {lstatImpl: failingLstat({code: 'ENOENT'})}))).resolves.toEqual([])
  })

  it.each([
    ['an error with another code', Object.assign(new Error('denied'), {code: 'EACCES'}), 'denied'],
    ['an object with another code', {code: 'EIO'}, '[object Object]'],
    ['an object with no code', {}, '[object Object]'],
    ['null', null, 'null'],
    ['undefined', undefined, 'undefined'],
    ['a string that reads ENOENT', 'ENOENT', 'ENOENT'],
    ['a number', 42, '42'],
  ])('fails closed on %s, naming the path and the message', async (_label, error, message) => {
    await expect(captureWikiScopeSnapshot(seams([], {lstatImpl: failingLstat(error)}))).rejects.toThrow(
      new Error(`failed to stat knowledge/wiki: ${message}`),
    )
  })

  it('fails closed on an entry that vanished between the listing and the stat, even for ENOENT', async () => {
    const lstatImpl = async (absolutePath: string) => {
      if (absolutePath.endsWith('/gone.md')) throw Object.assign(new Error('gone'), {code: 'ENOENT'})
      return absolutePath.endsWith('wiki') ? directory : file
    }
    await expect(captureWikiScopeSnapshot(seams(['a.md', 'gone.md'], {lstatImpl}))).rejects.toThrow(
      new Error('failed to stat knowledge/wiki/gone.md: gone'),
    )
  })

  it('reports a failed listing and a failed read with the path and the message', async () => {
    const readdirImpl = async () => {
      throw new Error('no listing')
    }
    await expect(captureWikiScopeSnapshot(seams([], {readdirImpl}))).rejects.toThrow(
      new Error('failed to enumerate knowledge/wiki: no listing'),
    )
    const readFileImpl = async () => {
      throw new Error('no read')
    }
    await expect(captureWikiScopeSnapshot(seams(['a.md'], {readFileImpl}))).rejects.toThrow(
      new Error('failed to read knowledge/wiki/a.md: no read'),
    )
  })

  it('names a symlink and a non-regular entry', async () => {
    const symlink = {...file, isSymbolicLink: () => true}
    await expect(captureWikiScopeSnapshot(seams([], {lstatImpl: async () => symlink}))).rejects.toThrow(
      new Error('refusing symlink in scope: knowledge/wiki'),
    )
    const socket = {isSymbolicLink: () => false, isDirectory: () => false, isFile: () => false}
    await expect(captureWikiScopeSnapshot(seams([], {lstatImpl: async () => socket}))).rejects.toThrow(
      new Error('non-regular entry in scope: knowledge/wiki'),
    )
  })

  it('writes a scope path given with backslashes as a forward-slash relative path', async () => {
    const snapshot = await captureWikiScopeSnapshot(seams(['a.md'], {scopePaths: [String.raw`knowledge\wiki`]}))
    expect(snapshot.map(entry => entry.relativePath)).toEqual([String.raw`knowledge\wiki/a.md`.replace('\\', '/')])
  })
})

describe('the check-ignore result', () => {
  it('drops the paths git reports as ignored, reading the NUL-terminated list including its last entry', async () => {
    const runner: WikiChangeDetectCheckIgnoreRunnerFn = async () => ({
      stdout: 'knowledge/wiki/a.md\0knowledge/wiki/c.md\0',
      exitCode: 0,
    })
    const snapshot = await captureWikiScopeSnapshot(seams(['a.md', 'b.md', 'c.md'], {checkIgnoreRunnerImpl: runner}))
    expect(snapshot.map(entry => entry.relativePath)).toEqual(['knowledge/wiki/b.md'])
  })

  it('treats a list with no trailing NUL as complete, and fails closed on a path git was not asked about', async () => {
    const unterminated: WikiChangeDetectCheckIgnoreRunnerFn = async () => ({stdout: 'knowledge/wiki/a.md', exitCode: 0})
    await expect(
      captureWikiScopeSnapshot(seams(['a.md', 'b.md'], {checkIgnoreRunnerImpl: unterminated})),
    ).resolves.toHaveLength(1)
    const stranger: WikiChangeDetectCheckIgnoreRunnerFn = async () => ({stdout: 'knowledge/wiki/zzz.md\0', exitCode: 0})
    await expect(captureWikiScopeSnapshot(seams(['a.md'], {checkIgnoreRunnerImpl: stranger}))).rejects.toThrow(
      new Error('git check-ignore returned a path outside the candidate set: knowledge/wiki/zzz.md'),
    )
    const emptyEntry: WikiChangeDetectCheckIgnoreRunnerFn = async () => ({
      stdout: 'knowledge/wiki/a.md\0\0',
      exitCode: 0,
    })
    await expect(captureWikiScopeSnapshot(seams(['a.md'], {checkIgnoreRunnerImpl: emptyEntry}))).rejects.toThrow(
      'git check-ignore returned a path outside the candidate set: ',
    )
  })

  it('reads a clean exit that reports no stdout as nothing ignored', async () => {
    const quiet: WikiChangeDetectCheckIgnoreRunnerFn = async () => ({exitCode: 0})
    await expect(captureWikiScopeSnapshot(seams(['a.md'], {checkIgnoreRunnerImpl: quiet}))).resolves.toHaveLength(1)
  })

  it('fails closed on an unexpected exit status and on a runner that throws', async () => {
    await expect(
      captureWikiScopeSnapshot(seams(['a.md'], {checkIgnoreRunnerImpl: async () => ({stdout: '', exitCode: 128})})),
    ).rejects.toThrow(new Error('git check-ignore exited with unexpected status 128'))
    const throwing: WikiChangeDetectCheckIgnoreRunnerFn = async () => {
      throw new Error('spawn failed')
    }
    await expect(captureWikiScopeSnapshot(seams(['a.md'], {checkIgnoreRunnerImpl: throwing}))).rejects.toThrow(
      new Error('git check-ignore failed: spawn failed'),
    )
  })
})

describe('the real filesystem and real git, in a test-owned temp repository', () => {
  const roots: string[] = []
  afterEach(() => {
    while (roots.length > 0) {
      const root = roots.pop()
      if (root !== undefined) rmSync(root, {recursive: true, force: true})
    }
  })

  function repository(files: Record<string, string>, gitignore = ''): string {
    const root = mkdtempSync(join(tmpdir(), 'wiki-change-detect-core-'))
    roots.push(root)
    execFileSync('git', ['init', '-q', '-b', 'main'], {cwd: root, stdio: 'ignore'})
    writeFileSync(join(root, '.gitignore'), gitignore)
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(root, path, '..'), {recursive: true})
      writeFileSync(join(root, path), content)
    }
    return root
  }

  it('walks, filters and hashes with the default seams, and skips a scope root that is absent', async () => {
    const root = repository({
      'knowledge/wiki/topics/b.md': 'b',
      'knowledge/wiki/topics/a.md': 'a',
      'knowledge/index.md': 'i',
    })
    const snapshot = await captureWikiScopeSnapshot({
      cwd: root,
      scopePaths: ['knowledge/index.md', 'knowledge/log.md', 'knowledge/wiki'],
    })
    expect(snapshot.map(entry => entry.relativePath)).toEqual([
      'knowledge/index.md',
      'knowledge/wiki/topics/a.md',
      'knowledge/wiki/topics/b.md',
    ])
    expect(snapshot[1]?.hash).toBe('ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb')
  })

  it('reads a list of ignored paths longer than 64 bytes from git', async () => {
    const names = Array.from({length: 6}, (_, index) => `ignored-page-with-a-long-name-${index}.md`)
    const files = Object.fromEntries(names.map(name => [`knowledge/wiki/topics/${name}`, name]))
    const root = repository({...files, 'knowledge/wiki/topics/kept.md': 'kept'}, 'ignored-*.md\n')
    const snapshot = await captureWikiScopeSnapshot({cwd: root, scopePaths: ['knowledge/wiki']})
    expect(snapshot.map(entry => entry.relativePath)).toEqual(['knowledge/wiki/topics/kept.md'])
  })
})

describe('hashWikiScopeSnapshot', () => {
  it('hashes NUL-terminated path and content-hash fields in order, so no two snapshots share the bytes', () => {
    const entries = [
      {relativePath: 'a', hash: 'x'},
      {relativePath: 'b', hash: 'y'},
    ]
    expect(hashWikiScopeSnapshot(entries)).toBe(createHash('sha256').update('a\0x\0b\0y\0').digest('hex'))
    expect(hashWikiScopeSnapshot([])).toBe(createHash('sha256').update('').digest('hex'))
    expect(hashWikiScopeSnapshot([{relativePath: 'a', hash: 'xb'}])).not.toBe(
      hashWikiScopeSnapshot([
        {relativePath: 'a', hash: 'x'},
        {relativePath: '', hash: 'b'},
      ]),
    )
  })
})

describe('the default check-ignore runner', () => {
  it('reports a git that cannot start as a failed check, not as an exit status', async () => {
    const missing = join(tmpdir(), `wiki-change-detect-core-missing-${process.pid}`)
    await expect(
      captureWikiScopeSnapshot({
        ...seams(['a.md']),
        cwd: missing,
        checkIgnoreRunnerImpl: undefined,
      }),
    ).rejects.toThrow(/^git check-ignore failed: .*ENOENT/u)
  })
})
