/**
 * `runWikiHandoffBaseline` and `runWikiHandoffBuild` take the checkout as a `cwd` argument. Both read the
 * files from it and must run `git status` in it too: a checkout that is not the process working directory
 * would otherwise give an empty artifact. Every checkout here is a test-owned temp git repository.
 */

import {execFileSync} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import process from 'node:process'
import {afterEach, describe, expect, it} from 'vitest'
import {runWikiHandoffBaseline} from './wiki-handoff-baseline.ts'
import {runWikiHandoffBuild} from './wiki-handoff-build.ts'

const roots: string[] = []

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop()
    if (root !== undefined) rmSync(root, {recursive: true, force: true})
  }
})

function git(cwd: string, ...args: string[]): void {
  execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    {cwd, stdio: 'ignore'},
  )
}

function write(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), {recursive: true})
  writeFileSync(join(root, path), content)
}

/** A committed wiki checkout in a temp directory that is not the process working directory. */
function wikiCheckout(): string {
  const root = mkdtempSync(join(tmpdir(), 'wiki-handoff-cwd-'))
  roots.push(root)
  write(root, 'knowledge/index.md', '# Index\n')
  write(root, 'knowledge/log.md', '# Log\n')
  write(root, 'knowledge/wiki/topics/alpha.md', 'alpha\n')
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'init')
  write(root, 'knowledge/wiki/topics/alpha.md', 'alpha edited\n')
  write(root, 'knowledge/wiki/topics/beta.md', 'beta\n')
  expect(root).not.toBe(process.cwd())
  return root
}

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'wiki-handoff-out-'))
  roots.push(root)
  return root
}

describe('the checkout argument decides where git status runs', () => {
  it('baseline hashes the edited and the new page of a checkout that is not the working directory', async () => {
    const checkout = wikiCheckout()
    const baselinePath = join(scratch(), 'baseline.json')
    const out: string[] = []
    await runWikiHandoffBaseline({WIKI_HANDOFF_BASELINE_PATH: baselinePath}, {stdout: text => out.push(text)}, checkout)
    expect(out).toEqual(['{"files":2}\n'])
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as {
      files: Record<string, string>
      deleted: string[]
    }
    expect(Object.keys(baseline.files).toSorted()).toEqual([
      'knowledge/wiki/topics/alpha.md',
      'knowledge/wiki/topics/beta.md',
    ])
    expect(baseline.deleted).toEqual([])
  })

  it('build carries the edited and the new page of a checkout that is not the working directory', async () => {
    const checkout = wikiCheckout()
    const outDir = join(scratch(), 'handoff')
    const out: string[] = []
    await runWikiHandoffBuild({WIKI_HANDOFF_DIR: outDir}, {stdout: text => out.push(text)}, checkout)
    expect(out).toEqual(['{"changed":2,"deleted":0}\n'])
    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')) as {changed: string[]}
    expect(manifest.changed.toSorted()).toEqual(['knowledge/wiki/topics/alpha.md', 'knowledge/wiki/topics/beta.md'])
    expect(readFileSync(join(outDir, 'files/knowledge/wiki/topics/beta.md'), 'utf8')).toBe('beta\n')
  })

  it('build scopes to a baseline captured from the same checkout', async () => {
    const checkout = wikiCheckout()
    const work = scratch()
    const baselinePath = join(work, 'baseline.json')
    await runWikiHandoffBaseline({WIKI_HANDOFF_BASELINE_PATH: baselinePath}, {stdout: () => undefined}, checkout)
    write(checkout, 'knowledge/wiki/topics/gamma.md', 'gamma\n')
    const outDir = join(work, 'handoff')
    const out: string[] = []
    await runWikiHandoffBuild(
      {WIKI_HANDOFF_DIR: outDir, WIKI_HANDOFF_BASELINE_PATH: baselinePath},
      {stdout: text => out.push(text)},
      checkout,
    )
    expect(out).toEqual(['{"changed":1,"deleted":0}\n'])
    expect(existsSync(join(outDir, 'files/knowledge/wiki/topics/gamma.md'))).toBe(true)
  })
})
