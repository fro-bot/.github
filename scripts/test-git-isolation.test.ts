import {spawnSync} from 'node:child_process'
import process from 'node:process'
import {describe, expect, it} from 'vitest'

// `vitest.config.ts` sets `test.env` so that a developer's global git config (for example
// `commit.gpgsign=true`) never reaches the git fixtures tests create. CI has no global config, so this is
// the test that fails there when that setting is removed.
describe('git in the test process', () => {
  it('reads no global or system config', () => {
    expect(process.env.GIT_CONFIG_GLOBAL).toBe('/dev/null')
    expect(process.env.GIT_CONFIG_NOSYSTEM).toBe('1')
  })

  it('sees no global or system settings from a child git', () => {
    // `--system` reads the system file even under GIT_CONFIG_NOSYSTEM, so the check is on what git loads.
    const listed = spawnSync('git', ['config', '--show-scope', '--list'], {cwd: '/', encoding: 'utf8'})
    expect(listed.status, listed.stderr).toBe(0)
    const scopes = new Set(listed.stdout.split('\n').map(line => line.split('\t')[0]))
    expect(scopes.has('global')).toBe(false)
    expect(scopes.has('system')).toBe(false)
  })
})
