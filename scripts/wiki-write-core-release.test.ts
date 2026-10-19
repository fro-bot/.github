import type {Decision, Git, InstallCommand, PluginStep, ReleaseCommit, ToolPins} from './wiki-write-core-release.ts'

import {execFileSync, spawnSync} from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import process from 'node:process'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {
  assertToolsInstalled,
  buildToolManifest,
  decideRelease,
  filterPackageCommits,
  formatGithubOutput,
  incrementVersion,
  installReleaseTools,
  loadReleasePlugins,
  parseReleaserc,
  parseToolPins,
  PREFIX_ENV,
  readCommitsSince,
  RELEASE_TOOLS,
  RELEASERC_FILE,
  resolvePrefix,
  selectBaseTag,
  TAG_FORMAT,
  TOOLS_WORKFLOW_FILE,
} from './wiki-write-core-release.ts'

const repositoryRoot = join(import.meta.dirname, '..')
const PACKAGE_FILE = 'packages/wiki-write-core/src/x.ts'

function commit(message: string, ...paths: string[]): ReleaseCommit {
  return {hash: 'a'.repeat(40), message, committerDate: '2026-10-18T00:00:00Z', paths}
}

describe('selectBaseTag', () => {
  it('picks the highest version by numeric comparison, whatever order the tags were created in', () => {
    expect(selectBaseTag(['wiki-write-core-v0.2.0', 'wiki-write-core-v0.10.0'])).toBe('wiki-write-core-v0.10.0')
    expect(selectBaseTag(['wiki-write-core-v0.10.0', 'wiki-write-core-v0.2.0'])).toBe('wiki-write-core-v0.10.0')
    expect(selectBaseTag(['wiki-write-core-v0.9.9', 'wiki-write-core-v1.0.0', 'wiki-write-core-v0.99.0'])).toBe(
      'wiki-write-core-v1.0.0',
    )
  })

  it('compares patch numbers numerically', () => {
    expect(selectBaseTag(['wiki-write-core-v0.1.9', 'wiki-write-core-v0.1.10'])).toBe('wiki-write-core-v0.1.10')
  })

  it('returns undefined when no tag is a wiki-write-core release tag', () => {
    expect(selectBaseTag([])).toBeUndefined()
    expect(selectBaseTag(['v1.0.0', 'wiki-write-core-v1.0', 'other-v1.0.0'])).toBeUndefined()
  })

  it.each([
    ['a prerelease', 'wiki-write-core-v9.0.0-rc.1'],
    ['build metadata', 'wiki-write-core-v9.0.0+build'],
    ['a leading zero', 'wiki-write-core-v09.0.0'],
    ['a trailing suffix', 'wiki-write-core-v9.0.0x'],
    ['a prefix', 'xwiki-write-core-v9.0.0'],
  ])('ignores %s', (_label, tag) => {
    expect(selectBaseTag([tag, 'wiki-write-core-v0.1.0'])).toBe('wiki-write-core-v0.1.0')
  })
})

describe('incrementVersion', () => {
  it.each([
    ['0.0.0', 'minor', '0.1.0'],
    ['0.1.0', 'minor', '0.2.0'],
    ['0.1.7', 'minor', '0.2.0'],
    ['0.1.7', 'patch', '0.1.8'],
    ['0.10.9', 'patch', '0.10.10'],
    ['1.0.0', 'major', '2.0.0'],
    ['1.4.2', 'major', '2.0.0'],
    ['1.4.2', 'minor', '1.5.0'],
  ] as const)('%s + %s = %s', (base, type, expected) => {
    expect(incrementVersion(base, type)).toBe(expected)
  })

  it.each(['0.0.0', '0.1.0', '0.9.9'])('refuses a major release from the 0.x base %s', base => {
    expect(() => incrementVersion(base, 'major')).toThrow('a 0.x package does not release a major version')
  })
})

describe('filterPackageCommits', () => {
  it('keeps a commit that changes a path under the package', () => {
    const kept = commit('feat: x', 'packages/wiki-write-core/src/x.ts')
    expect(filterPackageCommits([kept])).toEqual([kept])
  })

  it('keeps a commit that touches the package and other trees', () => {
    const kept = commit('fix: x', 'scripts/x.ts', 'packages/wiki-write-core/README.md')
    expect(filterPackageCommits([kept])).toEqual([kept])
  })

  it('drops a commit that only touches other trees', () => {
    expect(filterPackageCommits([commit('feat: x', 'scripts/x.ts', 'README.md')])).toEqual([])
  })

  it('does not count a sibling directory that shares the package name as a prefix', () => {
    expect(filterPackageCommits([commit('feat: x', 'packages/wiki-write-core-extra/src/x.ts')])).toEqual([])
  })

  it('does not count a file at the package path itself or a path that merely contains it', () => {
    expect(
      filterPackageCommits([
        commit('feat: x', 'packages/wiki-write-core'),
        commit('feat: y', 'docs/packages/wiki-write-core/x.md'),
      ]),
    ).toEqual([])
  })

  it('keeps only the commits that touch the package out of several', () => {
    const touching = commit('feat: kept', 'packages/wiki-write-core/src/x.ts')
    const result = filterPackageCommits([
      commit('feat: outside one', 'scripts/a.ts'),
      touching,
      commit('fix: outside two', '.github/workflows/x.yaml'),
    ])
    expect(result).toEqual([touching])
  })

  it('drops commits marked [skip release] or [release skip], in any case, anywhere in the message', () => {
    const path = 'packages/wiki-write-core/src/x.ts'
    expect(filterPackageCommits([commit('feat: x [skip release]', path)])).toEqual([])
    expect(filterPackageCommits([commit('feat: x [release skip]', path)])).toEqual([])
    expect(filterPackageCommits([commit('feat: x\n\nbody\n\n[Skip Release]', path)])).toEqual([])
  })

  it('does not treat similar bracket text as a skip marker', () => {
    const kept = commit('feat: x [skip ci]', 'packages/wiki-write-core/src/x.ts')
    expect(filterPackageCommits([kept])).toEqual([kept])
  })
})

describe('readCommitsSince', () => {
  const first = 'a'.repeat(40)
  const second = 'b'.repeat(40)

  function fakeGit(overrides: {diff?: (hash: string) => string} = {}): {git: Git; calls: string[][]} {
    const calls: string[][] = []
    const git: Git = args => {
      calls.push([...args])
      if (args[0] === 'rev-list') return `${first}\n${second}\n`
      if (args[0] === 'log') return `2026-10-18T10:00:00+00:00\nfeat: ${args[3]?.[0] ?? ''}\n\nbody line\n`
      if (args[0] === 'diff')
        return (overrides.diff ?? (() => 'scripts/a.ts\0packages/wiki-write-core/src/x.ts\0'))(String(args[5]))
      throw new Error(`unexpected git ${args.join(' ')}`)
    }
    return {git, calls}
  }

  it('lists the commits in the range with their message, date and changed paths', () => {
    const {git, calls} = fakeGit()

    const commits = readCommitsSince(git, 'wiki-write-core-v0.0.0', 'HEAD')

    expect(commits.map(commit => commit.hash)).toEqual([first, second])
    expect(commits[0]).toEqual({
      hash: first,
      message: 'feat: a\n\nbody line',
      committerDate: '2026-10-18T10:00:00+00:00',
      paths: ['scripts/a.ts', 'packages/wiki-write-core/src/x.ts'],
    })
    expect(calls[0]).toEqual(['rev-list', 'wiki-write-core-v0.0.0..HEAD', '--'])
  })

  it('diffs against the first parent without rename detection, so a path moved out of the package still counts', () => {
    const {git, calls} = fakeGit()

    readCommitsSince(git, 'wiki-write-core-v0.0.0', 'HEAD')

    expect(calls.find(call => call[0] === 'diff')).toEqual([
      'diff',
      '--name-only',
      '--no-renames',
      '-z',
      `${first}^1`,
      first,
      '--',
    ])
  })

  it('fails when the changed paths of a commit cannot be read', () => {
    const {git} = fakeGit({
      diff: () => {
        throw new Error('fatal: bad revision')
      },
    })

    expect(() => readCommitsSince(git, 'wiki-write-core-v0.0.0', 'HEAD')).toThrow(
      new RegExp(`cannot read the changed paths of commit ${first}.*bad revision`),
    )
  })

  it('fails on a rev-list line that is not a commit id', () => {
    const git: Git = () => '--upload-pack=evil\n'

    expect(() => readCommitsSince(git, 'wiki-write-core-v0.0.0', 'HEAD')).toThrow(/unexpected commit id/)
  })

  it('returns nothing for an empty range', () => {
    expect(readCommitsSince(() => '', 'wiki-write-core-v0.0.0', 'HEAD')).toEqual([])
  })
})

interface TestRepo {
  readonly dir: string
  readonly git: Git
  commit: (message: string, ...files: string[]) => string
  tag: (name: string, ref?: string) => void
}

function createRepo(): TestRepo {
  const dir = mkdtempSync(join(tmpdir(), 'wiki-write-core-release-repo-'))
  const git: Git = args =>
    execFileSync('git', [...args], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH ?? '',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      },
    })
  git(['init', '--quiet', '--initial-branch', 'main'])
  let counter = 0
  return {
    dir,
    git,
    commit: (message, ...files) => {
      counter += 1
      for (const file of files) {
        mkdirSync(dirname(join(dir, file)), {recursive: true})
        writeFileSync(join(dir, file), `${file} change ${counter}\n`)
      }
      git(['add', '--all'])
      git(['commit', '--quiet', '--allow-empty', '--message', message])
      return git(['rev-parse', 'HEAD']).trim()
    },
    tag: (name, ref = 'HEAD') => {
      git(['tag', name, ref])
    },
  }
}

describe('decideRelease', () => {
  let repo: TestRepo
  const analyzed: string[][] = []

  const logger = {log: () => {}, warn: () => {}, error: () => {}, success: () => {}}
  const releaserc = parseReleaserc(readFileSync(join(repositoryRoot, RELEASERC_FILE), 'utf8'))

  // Stand-ins that record what they were given, so these tests pin the commit selection alone.
  const analyzeCommits: PluginStep = async (_config, context) => {
    analyzed.push(context.commits.map(commit => commit.message))
    return 'minor'
  }
  const generateNotes: PluginStep = async (_config, context) =>
    `notes for ${context.nextRelease?.version ?? '?'}: ${context.commits.map(commit => commit.message).join(' | ')}`

  async function decide(ref = 'HEAD'): Promise<Decision> {
    return decideRelease({
      git: repo.git,
      ref,
      releaserc,
      plugins: {analyzeCommits, generateNotes},
      repositoryUrl: 'https://github.com/fro-bot/.github.git',
      cwd: repo.dir,
      logger,
    })
  }

  beforeEach(() => {
    repo = createRepo()
    analyzed.length = 0
    repo.commit('chore: seed', 'README.md')
    repo.tag('wiki-write-core-v0.0.0')
  })

  afterEach(() => {
    rmSync(repo.dir, {recursive: true, force: true})
  })

  it('releases minor 0.1.0 from a feat commit touching the package, with notes for it', async () => {
    repo.commit('feat: add the thing', PACKAGE_FILE)

    const decision = await decide()

    expect(decision).toMatchObject({
      release: true,
      type: 'minor',
      version: '0.1.0',
      baseTag: 'wiki-write-core-v0.0.0',
      notes: 'notes for 0.1.0: feat: add the thing',
    })
  })

  it('increments from the base tag by the analyzed type', async () => {
    repo.commit('fix: first', PACKAGE_FILE)
    repo.tag('wiki-write-core-v0.4.2')
    repo.commit('fix: second', PACKAGE_FILE)

    const decision = await decide()

    expect(decision).toMatchObject({release: true, version: '0.5.0', baseTag: 'wiki-write-core-v0.4.2'})
    expect(analyzed).toEqual([['fix: second']])
  })

  it('analyzes only the commits that touch the package: one of three here', async () => {
    repo.commit('feat: scripts only', 'scripts/a.ts')
    repo.commit('fix: the package', 'scripts/b.ts', PACKAGE_FILE)
    repo.commit('feat: docs only', 'docs/c.md')

    const decision = await decide()

    expect(analyzed).toEqual([['fix: the package']])
    expect(decision).toMatchObject({release: true, notes: 'notes for 0.1.0: fix: the package'})
  })

  it('releases nothing, and runs no plugin, when no commit since the base touches the package', async () => {
    repo.commit('feat: scripts only', 'scripts/a.ts')

    const decision = await decide()

    expect(decision).toMatchObject({release: false, baseTag: 'wiki-write-core-v0.0.0'})
    expect(analyzed).toEqual([])
  })

  it('does not count a change under a sibling directory that shares the package name as a prefix', async () => {
    repo.commit('feat: sibling', 'packages/wiki-write-core-extra/src/x.ts')

    expect(await decide()).toMatchObject({release: false})
  })

  it('excludes a feat commit marked [skip release]', async () => {
    repo.commit('feat: hidden [skip release]', PACKAGE_FILE)

    expect(await decide()).toMatchObject({release: false})
    expect(analyzed).toEqual([])
  })

  it('does not consider commits at or before the base tag', async () => {
    repo.commit('feat: already released', PACKAGE_FILE)
    repo.tag('wiki-write-core-v0.1.0')

    expect(await decide()).toMatchObject({release: false, baseTag: 'wiki-write-core-v0.1.0'})
  })

  it('uses the highest version as the base, whatever order the tags were created in', async () => {
    repo.commit('fix: one', PACKAGE_FILE)
    repo.tag('wiki-write-core-v0.10.0')
    repo.commit('fix: two', PACKAGE_FILE)
    repo.tag('wiki-write-core-v0.2.0')
    repo.commit('feat: three', PACKAGE_FILE)

    const decision = await decide()

    expect(decision).toMatchObject({release: true, version: '0.11.0', baseTag: 'wiki-write-core-v0.10.0'})
    // v0.2.0 sits above v0.10.0 in history but below it in version, so it must not shorten the range.
    expect(analyzed).toEqual([['feat: three', 'fix: two']])
  })

  it('ignores a release tag that is not reachable from the ref', async () => {
    repo.git(['switch', '--quiet', '--create', 'side'])
    repo.commit('chore: side', 'side.md')
    repo.tag('wiki-write-core-v0.9.0')
    repo.git(['switch', '--quiet', 'main'])
    repo.commit('feat: on main', PACKAGE_FILE)

    expect(await decide()).toMatchObject({release: true, version: '0.1.0', baseTag: 'wiki-write-core-v0.0.0'})
  })

  it('fails without a decision when no release tag is merged into the ref', async () => {
    repo.git(['tag', '--delete', 'wiki-write-core-v0.0.0'])
    repo.tag('other-v1.0.0')
    repo.commit('feat: x', PACKAGE_FILE)

    await expect(decide()).rejects.toThrow(/no wiki-write-core-v\* release tag is reachable from HEAD/)
    expect(analyzed).toEqual([])
  })

  it('surfaces an unreadable changed-path list as a failed decision', async () => {
    repo.commit('feat: x', PACKAGE_FILE)
    const failingGit: Git = args => {
      if (args[0] === 'diff') throw new Error('fatal: bad revision')
      return repo.git(args)
    }

    await expect(
      decideRelease({
        git: failingGit,
        ref: 'HEAD',
        releaserc,
        plugins: {analyzeCommits, generateNotes},
        repositoryUrl: 'https://github.com/fro-bot/.github.git',
        cwd: repo.dir,
        logger,
      }),
    ).rejects.toThrow(/cannot read the changed paths of commit/)
  })

  it('refuses a major release from a 0.x base, so the decision fails closed', async () => {
    repo.commit('feat!: break the package', PACKAGE_FILE)

    await expect(
      decideRelease({
        git: repo.git,
        ref: 'HEAD',
        releaserc,
        plugins: {analyzeCommits: async () => 'major', generateNotes},
        repositoryUrl: 'https://github.com/fro-bot/.github.git',
        cwd: repo.dir,
        logger,
      }),
    ).rejects.toThrow('a 0.x package does not release a major version')
  })

  it('releases a major version from a base of 1.x or higher', async () => {
    repo.commit('fix: reach 1.x', PACKAGE_FILE)
    repo.tag('wiki-write-core-v1.2.0')
    repo.commit('feat!: break the package', PACKAGE_FILE)

    const decision = await decideRelease({
      git: repo.git,
      ref: 'HEAD',
      releaserc,
      plugins: {analyzeCommits: async () => 'major', generateNotes},
      repositoryUrl: 'https://github.com/fro-bot/.github.git',
      cwd: repo.dir,
      logger,
    })

    expect(decision).toMatchObject({release: true, type: 'major', version: '2.0.0', baseTag: 'wiki-write-core-v1.2.0'})
  })

  it('rejects an analyzer result that is not a release type', async () => {
    repo.commit('feat: x', PACKAGE_FILE)

    await expect(
      decideRelease({
        git: repo.git,
        ref: 'HEAD',
        releaserc,
        plugins: {analyzeCommits: async () => 'premajor', generateNotes},
        repositoryUrl: 'https://github.com/fro-bot/.github.git',
        cwd: repo.dir,
        logger,
      }),
    ).rejects.toThrow(/unexpected release type/)
  })

  it('rejects empty notes for a releasable decision', async () => {
    repo.commit('feat: x', PACKAGE_FILE)

    await expect(
      decideRelease({
        git: repo.git,
        ref: 'HEAD',
        releaserc,
        plugins: {analyzeCommits, generateNotes: async () => '  '},
        repositoryUrl: 'https://github.com/fro-bot/.github.git',
        cwd: repo.dir,
        logger,
      }),
    ).rejects.toThrow(/no notes/)
  })

  it('hands the analyzer the merged step options and the notes generator the release context', async () => {
    repo.commit('feat: x', PACKAGE_FILE)
    const head = repo.git(['rev-parse', 'HEAD']).trim()
    const base = repo.git(['rev-parse', 'wiki-write-core-v0.0.0']).trim()
    let analyzerConfig: Record<string, unknown> = {}
    let notesContext: Parameters<PluginStep>[1] | undefined

    await decideRelease({
      git: repo.git,
      ref: 'HEAD',
      releaserc,
      plugins: {
        analyzeCommits: async config => {
          analyzerConfig = config
          return 'minor'
        },
        generateNotes: async (_config, context) => {
          notesContext = context
          return 'notes'
        },
      },
      repositoryUrl: 'https://github.com/fro-bot/.github.git',
      cwd: repo.dir,
      logger,
    })

    expect(analyzerConfig.preset).toBe('conventionalcommits')
    expect(analyzerConfig.releaseRules).toEqual((releaserc.analyzeCommits as {releaseRules: unknown[]}).releaseRules)
    expect(analyzerConfig).not.toHaveProperty('plugins')
    expect(notesContext?.lastRelease).toEqual({version: '0.0.0', gitTag: 'wiki-write-core-v0.0.0', gitHead: base})
    expect(notesContext?.nextRelease).toEqual({version: '0.1.0', gitTag: 'wiki-write-core-v0.1.0', gitHead: head})
    expect(notesContext?.options).toEqual({repositoryUrl: 'https://github.com/fro-bot/.github.git'})
  })
})

describe('formatGithubOutput', () => {
  it('writes the type, version and base tag of a release', () => {
    const decision: Decision = {
      release: true,
      type: 'minor',
      version: '0.1.0',
      baseTag: 'wiki-write-core-v0.0.0',
      baseVersion: '0.0.0',
      commits: [],
      notes: 'n',
    }
    expect(formatGithubOutput(decision)).toBe('type=minor\nversion=0.1.0\nbase-tag=wiki-write-core-v0.0.0\n')
  })

  it('writes type=none and an empty version when nothing releases', () => {
    const decision: Decision = {release: false, baseTag: 'wiki-write-core-v0.3.0', baseVersion: '0.3.0', commits: []}
    expect(formatGithubOutput(decision)).toBe('type=none\nversion=\nbase-tag=wiki-write-core-v0.3.0\n')
  })
})

describe('parseReleaserc', () => {
  it('accepts the committed policy', () => {
    const releaserc = parseReleaserc(readFileSync(join(repositoryRoot, RELEASERC_FILE), 'utf8'))

    expect(releaserc.branches).toEqual(['main'])
    expect(releaserc.tagFormat).toBe(TAG_FORMAT)
  })

  it.each([
    ['a different tag format', `branches: [main]\ntagFormat: '${TAG_FORMAT.replace('wiki-write-core-', '')}'\n`],
    ['no tag format', 'branches: [main]\n'],
    ['no branches', `tagFormat: '${TAG_FORMAT}'\n`],
    ['empty branches', `branches: []\ntagFormat: '${TAG_FORMAT}'\n`],
    ['a non-mapping document', '- a\n- b\n'],
  ])('rejects %s', (_label, text) => {
    expect(() => parseReleaserc(text)).toThrow()
  })
})

describe('release tool pins', () => {
  const workflow = (overrides: Record<string, string> = {}) =>
    [
      'name: x',
      'env:',
      ...RELEASE_TOOLS.map(
        ({versionKey}) => `  ${versionKey}: ${overrides[versionKey] ?? '1.2.3'} # renovate: datasource=npm`,
      ),
      'jobs: {}',
      '',
    ].join('\n')

  it('reads every pin from the workflow-level env', () => {
    const pins = parseToolPins(workflow(), 'wf.yaml')

    expect(Object.keys(pins)).toEqual(RELEASE_TOOLS.map(({name}) => name))
    expect(new Set(Object.values(pins))).toEqual(new Set(['1.2.3']))
  })

  it.each([
    ['a range', '^1.2.3'],
    ['a tag', 'latest'],
    ['a partial version', '1.2'],
  ])('rejects %s', (_label, value) => {
    expect(() => parseToolPins(workflow({SEMANTIC_RELEASE_NPM_VERSION: value}), 'wf.yaml')).toThrow(
      /wf\.yaml: top-level env\.SEMANTIC_RELEASE_NPM_VERSION must be an exact x\.y\.z/,
    )
  })

  it('rejects a workflow with no env block', () => {
    expect(() => parseToolPins('name: x\njobs: {}\n', 'wf.yaml')).toThrow(/SEMANTIC_RELEASE_VERSION/)
  })

  it('reads the pins declared in the workflow the scripts and CI both use', () => {
    const pins = parseToolPins(readFileSync(join(repositoryRoot, TOOLS_WORKFLOW_FILE), 'utf8'), TOOLS_WORKFLOW_FILE)

    expect(pins['semantic-release']).toBe('25.0.9')
    expect(pins['conventional-changelog-writer']).toBe('9.3.0')
  })
})

describe('scratch tool install', () => {
  let prefix: string
  const pins = Object.fromEntries(RELEASE_TOOLS.map(({name}, index) => [name, `1.0.${index}`])) as ToolPins

  function fakeInstall(): void {
    for (const {name} of RELEASE_TOOLS) {
      const directory = join(prefix, 'node_modules', name)
      mkdirSync(directory, {recursive: true})
      writeFileSync(join(directory, 'package.json'), JSON.stringify({name, version: pins[name]}))
    }
  }

  beforeEach(() => {
    prefix = mkdtempSync(join(tmpdir(), 'wiki-write-core-release-tools-'))
  })

  afterEach(() => {
    rmSync(prefix, {recursive: true, force: true})
  })

  it('writes a manifest with exact direct pins and a writer override equal to its direct pin', () => {
    const manifest = JSON.parse(buildToolManifest(pins)) as {
      dependencies: Record<string, string>
      overrides: Record<string, string>
    }

    expect(manifest.dependencies).toEqual(pins)
    expect(manifest.overrides).toEqual({'conventional-changelog-writer': pins['conventional-changelog-writer']})
  })

  it('installs with lifecycle scripts off, no lockfile and the release-age floor, with the scratch prefix as the working directory', async () => {
    const commands: InstallCommand[] = []

    const outcome = await installReleaseTools(prefix, pins, command => {
      commands.push(command)
      fakeInstall()
      return {status: 0}
    })

    expect(outcome).toBe('installed')
    expect(commands).toEqual([
      {
        command: 'bun',
        args: ['install', '--minimum-release-age=259200', '--ignore-scripts', '--no-save'],
        cwd: prefix,
      },
    ])
    expect(JSON.parse(readFileSync(join(prefix, 'package.json'), 'utf8'))).toMatchObject({dependencies: pins})
  })

  it('runs nothing when the pinned versions are already installed', async () => {
    fakeInstall()
    const commands: InstallCommand[] = []

    const outcome = await installReleaseTools(prefix, pins, command => {
      commands.push(command)
      return {status: 0}
    })

    expect(outcome).toBe('already-installed')
    expect(commands).toEqual([])
  })

  it('reinstalls when an installed version differs from its pin', async () => {
    fakeInstall()
    writeFileSync(join(prefix, 'node_modules', 'semantic-release', 'package.json'), JSON.stringify({version: '9.9.9'}))
    const commands: InstallCommand[] = []

    const outcome = await installReleaseTools(prefix, pins, command => {
      commands.push(command)
      fakeInstall()
      return {status: 0}
    })

    expect(outcome).toBe('installed')
    expect(commands).toHaveLength(1)
  })

  it('fails when bun exits non-zero or cannot start', async () => {
    await expect(installReleaseTools(prefix, pins, () => ({status: 1}))).rejects.toThrow(/bun install exited 1/)
    await expect(
      installReleaseTools(prefix, pins, () => ({status: null, error: new Error('ENOENT bun')})),
    ).rejects.toThrow(/bun install failed to start: ENOENT bun/)
  })

  it('fails when bun exits 0 but the pinned versions are not what landed', async () => {
    await expect(installReleaseTools(prefix, pins, () => ({status: 0}))).rejects.toThrow(/is not installed under/)
  })

  it('fails loudly when the prefix has no install, naming the prefix variable', async () => {
    await expect(assertToolsInstalled(join(prefix, 'missing'), pins)).rejects.toThrow(
      new RegExp(`semantic-release is not installed under ${PREFIX_ENV}=`),
    )
    await expect(loadReleasePlugins(join(prefix, 'missing'), pins)).rejects.toThrow(/is not installed under/)
  })

  it('fails loudly when an installed version differs from the pin', async () => {
    fakeInstall()
    writeFileSync(
      join(prefix, 'node_modules', '@semantic-release', 'npm', 'package.json'),
      JSON.stringify({version: '9.9.9'}),
    )

    await expect(assertToolsInstalled(prefix, pins)).rejects.toThrow(
      /@semantic-release\/npm under .* is 9\.9\.9 but the workflow pins/,
    )
  })
})

describe('resolvePrefix', () => {
  it('prefers the prefix variable, treats empty as unset, then falls back under the runner temp dir', () => {
    expect(resolvePrefix({[PREFIX_ENV]: '/custom', RUNNER_TEMP: '/runner'})).toBe('/custom')
    expect(resolvePrefix({[PREFIX_ENV]: '', RUNNER_TEMP: '/runner'})).toBe(
      join('/runner', 'wiki-write-core-release-tools'),
    )
    expect(resolvePrefix({RUNNER_TEMP: '/runner'})).toBe(join('/runner', 'wiki-write-core-release-tools'))
    expect(resolvePrefix({})).toBe(join(tmpdir(), 'wiki-write-core-release-tools'))
  })
})

// Runs the script as a child process, the way the workflow does, against a real git repository and a
// scratch prefix that holds stand-in plugins pinned to the versions the workflow declares.
describe('command line', () => {
  const scriptPath = join(repositoryRoot, 'scripts/wiki-write-core-release.ts')
  const workflowFile = join(repositoryRoot, TOOLS_WORKFLOW_FILE)
  const pins = parseToolPins(readFileSync(workflowFile, 'utf8'), TOOLS_WORKFLOW_FILE)
  const releasercText = readFileSync(join(repositoryRoot, RELEASERC_FILE), 'utf8')

  let repo: TestRepo
  let scratch: string
  let prefix: string

  /** Installs every pinned tool as an empty package; the two plugins get a fake implementation. */
  function installFakeTools(): void {
    for (const {name} of RELEASE_TOOLS) {
      const directory = join(prefix, 'node_modules', name)
      mkdirSync(directory, {recursive: true})
      writeFileSync(
        join(directory, 'package.json'),
        JSON.stringify({name, version: pins[name], type: 'module', main: 'index.js'}),
      )
      writeFileSync(join(directory, 'index.js'), 'export {}\n')
    }
    writeFileSync(
      join(prefix, 'node_modules', '@semantic-release', 'commit-analyzer', 'index.js'),
      'export const analyzeCommits = async () => process.env.FAKE_RELEASE_TYPE || null\n',
    )
    writeFileSync(
      join(prefix, 'node_modules', '@semantic-release', 'release-notes-generator', 'index.js'),
      "export const generateNotes = async (_config, context) => '## ' + context.nextRelease.version + '\\n\\nfake notes\\n\\n'\n",
    )
  }

  function runCli(
    script: string,
    args: readonly string[],
    extraEnv: Record<string, string> = {},
  ): {status: number | null; stdout: string; stderr: string} {
    const result = spawnSync(process.execPath, [script, ...args], {
      cwd: repo.dir,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
        [PREFIX_ENV]: prefix,
        ...extraEnv,
      },
    })
    return {status: result.status, stdout: result.stdout, stderr: result.stderr}
  }

  function decide(extraEnv: Record<string, string> = {}, script = scriptPath, notesFile = join(scratch, 'notes.md')) {
    return runCli(script, ['decide', '--workflow', workflowFile, '--notes', notesFile], extraEnv)
  }

  beforeEach(() => {
    repo = createRepo()
    scratch = mkdtempSync(join(tmpdir(), 'wiki-write-core-release-cli-'))
    prefix = join(scratch, 'prefix')
    installFakeTools()
    repo.git(['remote', 'add', 'origin', 'https://github.com/fro-bot/.github.git'])
    mkdirSync(join(repo.dir, dirname(RELEASERC_FILE)), {recursive: true})
    writeFileSync(join(repo.dir, RELEASERC_FILE), releasercText)
    repo.commit('chore: seed', 'README.md')
    repo.tag('wiki-write-core-v0.0.0')
  })

  afterEach(() => {
    rmSync(repo.dir, {recursive: true, force: true})
    rmSync(scratch, {recursive: true, force: true})
  })

  it('runs main() when the script path contains a space', () => {
    const spaced = join(scratch, 'a directory with spaces')
    mkdirSync(spaced)
    // `yaml` resolves through the repository's node_modules, so the copy links to it.
    symlinkSync(join(repositoryRoot, 'node_modules'), join(spaced, 'node_modules'))
    const copy = join(spaced, 'wiki-write-core-release.ts')
    copyFileSync(scriptPath, copy)
    repo.git(['tag', '--delete', 'wiki-write-core-v0.0.0'])

    const result = decide({}, copy)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('no wiki-write-core-v* release tag is reachable from HEAD')
  })

  it('appends type, version and base-tag to GITHUB_OUTPUT, prints them, and writes the notes file', () => {
    repo.commit('feat: add the thing', PACKAGE_FILE)
    const githubOutput = join(scratch, 'github-output')
    writeFileSync(githubOutput, 'existing=1\n')
    const notesFile = join(scratch, 'nested', 'notes.md')

    const result = decide({GITHUB_OUTPUT: githubOutput, FAKE_RELEASE_TYPE: 'minor'}, scriptPath, notesFile)

    const expected = 'type=minor\nversion=0.1.0\nbase-tag=wiki-write-core-v0.0.0\n'
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(expected)
    expect(readFileSync(githubOutput, 'utf8')).toBe(`existing=1\n${expected}`)
    expect(readFileSync(notesFile, 'utf8')).toBe('## 0.1.0\n\nfake notes\n')
  })

  it('reports type=none and writes no notes when nothing releases', () => {
    repo.commit('feat: scripts only', 'scripts/a.ts')
    const githubOutput = join(scratch, 'github-output')
    const notesFile = join(scratch, 'notes.md')

    const result = decide({GITHUB_OUTPUT: githubOutput, FAKE_RELEASE_TYPE: 'minor'}, scriptPath, notesFile)

    const expected = 'type=none\nversion=\nbase-tag=wiki-write-core-v0.0.0\n'
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(expected)
    expect(readFileSync(githubOutput, 'utf8')).toBe(expected)
    expect(existsSync(notesFile)).toBe(false)
  })

  it('reports type=none when the analyzer finds no releasable commit', () => {
    repo.commit('chore: tidy the package', PACKAGE_FILE)

    const result = decide()

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('type=none\nversion=\nbase-tag=wiki-write-core-v0.0.0\n')
  })

  it('writes nothing to GITHUB_OUTPUT when the variable is unset', () => {
    repo.commit('feat: add the thing', PACKAGE_FILE)

    const result = decide({FAKE_RELEASE_TYPE: 'patch'})

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('type=patch\nversion=0.0.1\nbase-tag=wiki-write-core-v0.0.0\n')
  })

  it('fails closed, with no output and no notes, on a major release from a 0.x base', () => {
    repo.commit('feat!: break the package', PACKAGE_FILE)
    const githubOutput = join(scratch, 'github-output')
    const notesFile = join(scratch, 'notes.md')

    const result = decide({GITHUB_OUTPUT: githubOutput, FAKE_RELEASE_TYPE: 'major'}, scriptPath, notesFile)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('a 0.x package does not release a major version')
    expect(existsSync(githubOutput)).toBe(false)
    expect(existsSync(notesFile)).toBe(false)
  })

  it.each([
    ['an unknown command', ['bogus'], /usage: wiki-write-core-release\.ts <install\|decide>/],
    ['no command', [], /usage: wiki-write-core-release\.ts/],
    ['an unknown flag', ['decide', '--bogus', 'x'], /decide: unknown argument "--bogus"/],
    ['a flag allowed only for another command', ['install', '--notes', 'x'], /install: unknown argument "--notes"/],
    ['a flag without a value', ['decide', '--notes'], /decide: --notes requires a value/],
    ['decide without --notes', ['decide', '--workflow', workflowFile], /decide: --notes <path> is required/],
  ])('exits 1 with a message for %s', (_label, args, message) => {
    const result = runCli(scriptPath, args)

    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(message)
    expect(result.stdout).toBe('')
  })

  it('prints the prefix and installs nothing when the pinned tools are already present', () => {
    const result = runCli(scriptPath, ['install', '--workflow', workflowFile])

    expect(result.status).toBe(0)
    expect(result.stdout).toBe(`${prefix}\n`)
    expect(result.stderr).toContain('already-installed')
  })
})

// Needs the pinned install in WIKI_WRITE_CORE_RELEASE_PREFIX (the `Check Workflows` job provides it
// through `node scripts/wiki-write-core-release.ts install`); skipped by a plain `bun run test`. With the
// variable set but nothing installed there, every case fails.
describe.skipIf(process.env[PREFIX_ENV] === undefined)('against the pinned release tools', () => {
  const prefix = resolvePrefix()
  const pins = parseToolPins(readFileSync(join(repositoryRoot, TOOLS_WORKFLOW_FILE), 'utf8'), TOOLS_WORKFLOW_FILE)
  const releaserc = parseReleaserc(readFileSync(join(repositoryRoot, RELEASERC_FILE), 'utf8'))
  const logger = {log: () => {}, warn: () => {}, error: () => {}, success: () => {}}

  let repo: TestRepo

  beforeEach(() => {
    repo = createRepo()
    repo.commit('chore: seed', 'README.md')
    repo.tag('wiki-write-core-v0.0.0')
  })

  afterEach(() => {
    rmSync(repo.dir, {recursive: true, force: true})
  })

  async function decideWithRealPlugins(): Promise<Decision> {
    return decideRelease({
      git: repo.git,
      ref: 'HEAD',
      releaserc,
      plugins: await loadReleasePlugins(prefix, pins),
      repositoryUrl: 'https://github.com/fro-bot/.github.git',
      cwd: prefix,
      logger,
    })
  }

  it('has the exact pinned versions installed, with the writer override applied', async () => {
    await assertToolsInstalled(prefix, pins)
    const generatorManifest = join(prefix, 'node_modules', '@semantic-release', 'release-notes-generator')

    expect(() =>
      readFileSync(join(generatorManifest, 'node_modules', 'conventional-changelog-writer', 'package.json')),
    ).toThrow(/ENOENT/)
  })

  it.each([
    ['feat: add a thing', 'minor', '0.1.0'],
    ['feat(api): add a scoped thing', 'minor', '0.1.0'],
    ['fix: repair a thing', 'patch', '0.0.1'],
    ['build: change the build', 'patch', '0.0.1'],
    ['build(deps): bump a runtime dependency', 'patch', '0.0.1'],
    ['docs(readme): describe a thing', 'patch', '0.0.1'],
    ['feat!: rename a thing', 'minor', '0.1.0'],
    ['fix!: change a fix', 'minor', '0.1.0'],
    ['feat: add a thing\n\nBREAKING CHANGE: the old thing is gone', 'minor', '0.1.0'],
  ] as const)('maps %j to %s', async (message, type, version) => {
    repo.commit(message, PACKAGE_FILE)

    expect(await decideWithRealPlugins()).toMatchObject({release: true, type, version})
  })

  it.each([
    ['build(dev): bump a dev dependency'],
    ['build(dev)!: breaking dev change'],
    ['docs: describe a thing elsewhere'],
    ['docs(rfcs): describe a proposal'],
    ['skip: a skipped commit'],
    ['chore: tidy'],
    ['test: cover a thing'],
    ['ci: change CI'],
    ['refactor: restructure'],
    ['not a conventional commit'],
  ])('releases nothing for %j', async message => {
    repo.commit(message, PACKAGE_FILE)

    expect(await decideWithRealPlugins()).toMatchObject({release: false})
  })

  it('writes notes for only the commits that touch the package', async () => {
    repo.commit('feat: scripts only feature', 'scripts/a.ts')
    repo.commit('fix: package fix', 'scripts/b.ts', PACKAGE_FILE)
    repo.commit('feat(api): package feature', PACKAGE_FILE)
    repo.commit('fix: workflow only fix', '.github/workflows/x.yaml')

    const decision = await decideWithRealPlugins()

    expect(decision).toMatchObject({release: true, type: 'minor', version: '0.1.0'})
    const notes = decision.release ? decision.notes : ''
    expect(notes).toContain(
      '## [0.1.0](https://github.com/fro-bot/.github/compare/wiki-write-core-v0.0.0...wiki-write-core-v0.1.0)',
    )
    expect(notes).toContain('package fix')
    expect(notes).toContain('package feature')
    expect(notes).not.toContain('scripts only feature')
    expect(notes).not.toContain('workflow only fix')
  })
})
