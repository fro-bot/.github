import {describe, expect, it} from 'vitest'

import {overlayWasAttempted, runStepWithStubs} from './workflow-step.ts'

describe('runStepWithStubs: existing contract', () => {
  it('exits per lsRemoteExit and records every stubbed call', () => {
    const run = runStepWithStubs('git ls-remote --exit-code origin data; echo "rc=$?"', {lsRemoteExit: 7})

    expect(run.status).toBe(0)
    expect(run.stdout).toContain('rc=7')
    expect(run.trace).toStrictEqual(['git ls-remote --exit-code origin data'])
  })

  it('defaults every stubbed subcommand to exit 0, silently', () => {
    const run = runStepWithStubs('git ls-remote origin data && git fetch origin data && git rev-parse FETCH_HEAD', {})

    expect(run.status).toBe(0)
    expect(run.stdout).toBe('')
    expect(run.stderr).toBe('')
  })

  it('fails the named subcommand with exit 128 and a fatal line', () => {
    const run = runStepWithStubs('git fetch origin data', {failSubcommand: 'fetch'})

    expect(run.status).toBe(128)
    expect(run.stderr).toContain('fatal: simulated fetch failure')
  })

  it('detects an attempted overlay from the trace', () => {
    expect(overlayWasAttempted(['git ls-remote origin data'])).toBe(false)
    expect(overlayWasAttempted(['git ls-remote origin data', 'git fetch origin data'])).toBe(true)
  })
})

describe('runStepWithStubs: exit sequences', () => {
  it('consumes one exit code per call, so [1, 0] fails the first call and passes the second', () => {
    const run = runStepWithStubs(
      ['git ls-remote origin data; echo "first=$?"', 'git ls-remote origin data; echo "second=$?"'].join('\n'),
      {exitSequences: {'ls-remote': [1, 0]}},
    )

    expect(run.stdout).toContain('first=1')
    expect(run.stdout).toContain('second=0')
    expect(run.trace).toStrictEqual(['git ls-remote origin data', 'git ls-remote origin data'])
  })

  it('repeats the last code once the sequence is exhausted', () => {
    const run = runStepWithStubs(
      ['git fetch a; echo "a=$?"', 'git fetch b; echo "b=$?"', 'git fetch c; echo "c=$?"'].join('\n'),
      {exitSequences: {fetch: [2, 0]}},
    )

    expect(run.stdout).toContain('a=2')
    expect(run.stdout).toContain('b=0')
    expect(run.stdout).toContain('c=0')
  })

  it('counts each subcommand on its own', () => {
    const run = runStepWithStubs(
      ['git fetch x; echo "f1=$?"', 'git restore y; echo "r1=$?"', 'git fetch x; echo "f2=$?"'].join('\n'),
      {exitSequences: {fetch: [1, 0], restore: [0]}},
    )

    expect(run.stdout).toContain('f1=1')
    expect(run.stdout).toContain('r1=0')
    expect(run.stdout).toContain('f2=0')
  })

  it('takes precedence over lsRemoteExit for ls-remote', () => {
    const run = runStepWithStubs('git ls-remote o d; echo "rc=$?"', {
      lsRemoteExit: 9,
      exitSequences: {'ls-remote': [3]},
    })

    expect(run.stdout).toContain('rc=3')
  })

  it('writes a fatal line to stderr for a failing sequenced call and nothing for a passing one', () => {
    const run = runStepWithStubs('git fetch o d || true\ngit fetch o d', {exitSequences: {fetch: [128, 0]}})

    expect(run.status).toBe(0)
    expect(run.stderr.match(/fatal: simulated fetch failure/g)).toHaveLength(1)
  })

  it('rejects a subcommand name that is not a plain git word', () => {
    expect(() => runStepWithStubs('true', {exitSequences: {'../x': [1]}})).toThrow(/subcommand/)
  })
})

describe('runStepWithStubs: sleep stub', () => {
  it('records each requested delay and does not sleep', () => {
    const started = Date.now()
    const run = runStepWithStubs('sleep 5\nsleep 10', {})

    expect(run.sleeps).toStrictEqual(['5', '10'])
    expect(Date.now() - started).toBeLessThan(4000)
    expect(run.trace).toStrictEqual([])
  })

  it('reports no sleeps when the step never sleeps', () => {
    expect(runStepWithStubs('true', {}).sleeps).toStrictEqual([])
  })
})

describe('runStepWithStubs: rev-parse output', () => {
  it('prints the configured output for git rev-parse', () => {
    const run = runStepWithStubs('sha="$(git rev-parse FETCH_HEAD)"; echo "sha=$sha"', {revParseOutput: 'abc123def456'})

    expect(run.stdout).toContain('sha=abc123def456')
  })

  it('stays silent when no output is configured', () => {
    const run = runStepWithStubs('git rev-parse FETCH_HEAD', {})

    expect(run.stdout).toBe('')
  })
})

describe('runStepWithStubs: GITHUB_OUTPUT readback', () => {
  it('returns the raw file and the key/value pairs the step wrote', () => {
    const run = runStepWithStubs('echo "data-sha=abc" >> "$GITHUB_OUTPUT"\necho "note=a=b" >> "$GITHUB_OUTPUT"', {})

    expect(run.githubOutput).toBe('data-sha=abc\nnote=a=b\n')
    expect(run.outputs).toStrictEqual({'data-sha': 'abc', note: 'a=b'})
  })

  it('reads a delimiter-form multi-line value', () => {
    const run = runStepWithStubs(String.raw`printf 'body<<EOF\nline1\nline2\nEOF\nafter=1\n' >> "$GITHUB_OUTPUT"`, {})

    expect(run.outputs).toStrictEqual({body: 'line1\nline2', after: '1'})
  })

  it('is empty when the step wrote nothing', () => {
    const run = runStepWithStubs('true', {})

    expect(run.githubOutput).toBe('')
    expect(run.outputs).toStrictEqual({})
  })

  it('still returns the output a failing step wrote before it failed', () => {
    const run = runStepWithStubs('echo "k=v" >> "$GITHUB_OUTPUT"\nexit 4', {})

    expect(run.status).toBe(4)
    expect(run.outputs).toStrictEqual({k: 'v'})
  })
})

describe('runStepWithStubs: spawn failure', () => {
  it('throws the spawn error instead of returning a run with missing streams', () => {
    // A step that prints more than spawnSync's output buffer holds fails the spawn with ENOBUFS.
    const flood = String.raw`head -c 4000000 /dev/zero | tr '\0' a`

    expect(() => runStepWithStubs(flood, {})).toThrow(/ENOBUFS/)
  })

  it('still returns a normal nonzero exit as a run, not a throw', () => {
    expect(runStepWithStubs('exit 3', {}).status).toBe(3)
  })
})
