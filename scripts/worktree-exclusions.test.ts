import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'

import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

const repositoryRoot = resolve(import.meta.dirname, '..')

function readText(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8')
}

// Git worktrees for this repo live in the repo-local `.worktrees/` directory. Each is a full
// checkout of another branch, so any tool that walks the tree from the root and does not honor
// .gitignore would lint, mutate, or scan that branch's files as if they were this one's.
describe('.worktrees exclusions', () => {
  it('is git-ignored, which ESLint and Prettier both honor', () => {
    // #when git is asked whether a file under .worktrees/ is ignored
    // #then it exits 0 (ignored); exit 1 would throw
    expect(() =>
      execFileSync('git', ['check-ignore', '-q', '.worktrees/probe/scripts/example.ts'], {cwd: repositoryRoot}),
    ).not.toThrow()
  })

  it('is excluded from the sandbox Stryker copies', () => {
    // #given Stryker does not honor .gitignore
    const config = JSON.parse(readText('stryker.config.json')) as {ignorePatterns?: readonly string[]}

    // #then
    expect(config.ignorePatterns).toContain('.worktrees')
  })

  it('is excluded from markdownlint-cli2, which does not honor .gitignore', () => {
    // #given
    const config = parse(readText('.markdownlint-cli2.yaml')) as {globs?: readonly string[]}

    // #then
    expect(config.globs).toContain('!.worktrees/**')
  })
})
