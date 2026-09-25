import {execFile, execFileSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import process from 'node:process'
import {promisify} from 'node:util'
import {afterEach, describe, expect, it} from 'vitest'

import {computeWikiChangeHash} from './wiki-change-detect-core.ts'

const execFileAsync = promisify(execFile)
const scriptPath = resolve(import.meta.dirname, 'wiki-change-detect.ts')
const WIKI_SCOPE_PATHS = ['knowledge/index.md', 'knowledge/log.md', 'knowledge/wiki']

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

/** A real git repo (not mocked) with the scoped knowledge/ layout already committed. */
function makeRepo(): string {
  const dir = makeTempDir('wiki-change-detect-')
  execFileSync('git', ['init', '-q', '-b', 'main'], {cwd: dir})
  execFileSync('git', ['config', 'user.email', 'test@example.com'], {cwd: dir})
  execFileSync('git', ['config', 'user.name', 'Test'], {cwd: dir})
  mkdirSync(join(dir, 'knowledge', 'wiki', 'repos'), {recursive: true})
  writeFileSync(join(dir, 'knowledge', 'index.md'), '# Index\n')
  writeFileSync(join(dir, 'knowledge', 'log.md'), '# Log\n')
  writeFileSync(join(dir, 'README.md'), '# Out of scope\n')
  execFileSync('git', ['add', '-A'], {cwd: dir})
  execFileSync('git', ['commit', '-q', '-m', 'init'], {cwd: dir})
  return dir
}

async function hashOf(cwd: string): Promise<string> {
  return computeWikiChangeHash({
    cwd,
    runGitDiff: async () => {
      const {stdout} = await execFileAsync('git', ['diff', '--no-ext-diff', '--', ...WIKI_SCOPE_PATHS], {cwd})
      return stdout
    },
    runGitStatus: async () => {
      const {stdout} = await execFileAsync(
        'git',
        ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...WIKI_SCOPE_PATHS],
        {cwd, encoding: 'utf8'},
      )
      return stdout
    },
  })
}

describe('computeWikiChangeHash (real git repos)', () => {
  it('is stable when nothing has changed since baseline', async () => {
    const dir = makeRepo()
    const baseline = await hashOf(dir)
    expect(await hashOf(dir)).toBe(baseline)
  })

  it('changes on a tracked knowledge/log.md edit', async () => {
    const dir = makeRepo()
    const baseline = await hashOf(dir)
    writeFileSync(join(dir, 'knowledge', 'log.md'), '# Log\n\nNew entry\n')
    expect(await hashOf(dir)).not.toBe(baseline)
  })

  it('changes when only a new untracked repo page appears', async () => {
    const dir = makeRepo()
    const baseline = await hashOf(dir)
    writeFileSync(join(dir, 'knowledge', 'wiki', 'repos', 'marcusrbrown-foo.md'), '# Foo\n')
    expect(await hashOf(dir)).not.toBe(baseline)
  })

  it('is unchanged for a file already untracked at baseline, and changes once that file is edited', async () => {
    const dir = makeRepo()
    const untrackedPath = join(dir, 'knowledge', 'wiki', 'repos', 'marcusrbrown-bar.md')
    writeFileSync(untrackedPath, '# Bar\n')
    const baseline = await hashOf(dir)

    expect(await hashOf(dir)).toBe(baseline)

    writeFileSync(untrackedPath, '# Bar\n\nEdited\n')
    expect(await hashOf(dir)).not.toBe(baseline)
  })

  it('is unchanged for edits outside the scoped paths', async () => {
    const dir = makeRepo()
    const baseline = await hashOf(dir)
    writeFileSync(join(dir, 'README.md'), '# Out of scope, edited\n')
    expect(await hashOf(dir)).toBe(baseline)
  })

  it('handles an untracked path with a space and non-ASCII characters', async () => {
    const dir = makeRepo()
    const baseline = await hashOf(dir)
    writeFileSync(join(dir, 'knowledge', 'wiki', 'repos', 'café repo ☃.md'), '# Snowman\n')
    expect(await hashOf(dir)).not.toBe(baseline)
  })

  it('rejects when run outside a git repository', async () => {
    const dir = makeTempDir('wiki-change-detect-non-git-')
    await expect(hashOf(dir)).rejects.toThrow()
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
  it('baseline mode writes hash=<sha256> to GITHUB_OUTPUT', () => {
    const dir = makeRepo()
    const outputPath = githubOutputPath(dir)
    const result = runCli(['baseline'], dir, {GITHUB_OUTPUT: outputPath})
    expect(result.status).toBe(0)
    expect(execFileSync('cat', [outputPath], {encoding: 'utf8'})).toMatch(/^hash=[0-9a-f]{64}\n$/)
  })

  it('detect mode writes changed=false when nothing changed since the fed baseline hash', () => {
    const dir = makeRepo()
    const baselineOutput = githubOutputPath(dir)
    runCli(['baseline'], dir, {GITHUB_OUTPUT: baselineOutput})
    const baselineHash = execFileSync('cat', [baselineOutput], {encoding: 'utf8'}).trim().replace('hash=', '')

    const detectOutput = join(dir, 'github-output-detect')
    const result = runCli(['detect'], dir, {GITHUB_OUTPUT: detectOutput, WIKI_CHANGE_BASELINE_HASH: baselineHash})
    expect(result.status).toBe(0)
    expect(execFileSync('cat', [detectOutput], {encoding: 'utf8'})).toBe('changed=false\n')
  })

  it('detect mode writes changed=true after a tracked edit', () => {
    const dir = makeRepo()
    const baselineOutput = githubOutputPath(dir)
    runCli(['baseline'], dir, {GITHUB_OUTPUT: baselineOutput})
    const baselineHash = execFileSync('cat', [baselineOutput], {encoding: 'utf8'}).trim().replace('hash=', '')

    writeFileSync(join(dir, 'knowledge', 'log.md'), '# Log\n\nNew entry\n')

    const detectOutput = join(dir, 'github-output-detect')
    const result = runCli(['detect'], dir, {GITHUB_OUTPUT: detectOutput, WIKI_CHANGE_BASELINE_HASH: baselineHash})
    expect(result.status).toBe(0)
    expect(execFileSync('cat', [detectOutput], {encoding: 'utf8'})).toBe('changed=true\n')
  })

  it('detect mode writes changed=true when only a new untracked repo page appeared', () => {
    const dir = makeRepo()
    const baselineOutput = githubOutputPath(dir)
    runCli(['baseline'], dir, {GITHUB_OUTPUT: baselineOutput})
    const baselineHash = execFileSync('cat', [baselineOutput], {encoding: 'utf8'}).trim().replace('hash=', '')

    writeFileSync(join(dir, 'knowledge', 'wiki', 'repos', 'marcusrbrown-foo.md'), '# Foo\n')

    const detectOutput = join(dir, 'github-output-detect')
    const result = runCli(['detect'], dir, {GITHUB_OUTPUT: detectOutput, WIKI_CHANGE_BASELINE_HASH: baselineHash})
    expect(result.status).toBe(0)
    expect(execFileSync('cat', [detectOutput], {encoding: 'utf8'})).toBe('changed=true\n')
  })

  it('fails non-zero and writes nothing when run outside a git repository', () => {
    const dir = makeTempDir('wiki-change-detect-non-git-')
    const outputPath = githubOutputPath(dir)
    const result = runCli(['baseline'], dir, {GITHUB_OUTPUT: outputPath})
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('::error::wiki-change-detect:')
    expect(() => execFileSync('cat', [outputPath])).toThrow()
  })

  it('fails non-zero and writes no changed=true when the baseline hash is missing in detect mode', () => {
    const dir = makeRepo()
    const detectOutput = githubOutputPath(dir)
    const result = runCli(['detect'], dir, {GITHUB_OUTPUT: detectOutput})
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('WIKI_CHANGE_BASELINE_HASH is required')
    expect(() => execFileSync('cat', [detectOutput])).toThrow()
  })

  it('fails non-zero and writes no changed=true when the baseline hash is empty in detect mode', () => {
    const dir = makeRepo()
    const detectOutput = githubOutputPath(dir)
    const result = runCli(['detect'], dir, {GITHUB_OUTPUT: detectOutput, WIKI_CHANGE_BASELINE_HASH: ''})
    expect(result.status).not.toBe(0)
    expect(() => execFileSync('cat', [detectOutput])).toThrow()
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
})
