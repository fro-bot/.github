import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'

import {afterEach, describe, expect, it, vi} from 'vitest'

import {appendStepSummary, writeGithubOutputs, type RunnerFileOptions} from './output.ts'

interface Write {
  readonly path: string
  readonly content: string
}

function recorder(): {readonly writes: Write[]; readonly append: (path: string, content: string) => void} {
  const writes: Write[] = []
  return {
    writes,
    append: (path, content) => {
      writes.push({path, content})
    },
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('writeGithubOutputs', () => {
  const env = {GITHUB_OUTPUT: '/runner/output'}

  it('writes a single-line value as name=value', () => {
    const {writes, append} = recorder()
    expect(writeGithubOutputs({scan_result: 'success'}, {onMissing: 'skip', env, append})).toBe(true)
    expect(writes).toEqual([{path: '/runner/output', content: 'scan_result=success\n'}])
  })

  it('writes nothing and returns false for no entries, so true always means a write happened', () => {
    const {writes, append} = recorder()
    expect(writeGithubOutputs({}, {onMissing: 'skip', env, append})).toBe(false)
    expect(writes).toEqual([])
  })

  it('still applies the missing-variable policy to no entries', () => {
    const {writes, append} = recorder()
    expect(writeGithubOutputs({}, {onMissing: 'skip', env: {}, append})).toBe(false)
    expect(() => writeGithubOutputs({}, {onMissing: 'throw', env: {}, append})).toThrow('GITHUB_OUTPUT is required')
    expect(writes).toEqual([])
  })

  it('writes every entry in object order in one append', () => {
    const {writes, append} = recorder()
    writeGithubOutputs({'selected-paths': '["a"]', 'byte-length': '12', hash: 'abc'}, {onMissing: 'skip', env, append})
    expect(writes).toEqual([{path: '/runner/output', content: 'selected-paths=["a"]\nbyte-length=12\nhash=abc\n'}])
  })

  it('keeps an empty value and a value containing = or <<', () => {
    const {writes, append} = recorder()
    writeGithubOutputs({empty: '', eq: 'a=b', heredoc: 'x<<y'}, {onMissing: 'skip', env, append})
    expect(writes[0]?.content).toBe('empty=\neq=a=b\nheredoc=x<<y\n')
  })

  it.each([
    ['\n', 'a\nb'],
    ['\r', 'a\rb'],
    ['\r\n', 'a\r\nb'],
    ['a trailing newline', 'ab\n'],
    ['a leading newline', '\nab'],
  ])('writes a value with %s in the heredoc form', (_label, value) => {
    const {writes, append} = recorder()
    writeGithubOutputs({excerpt: value}, {onMissing: 'skip', env, append, delimiter: () => 'DELIM_1'})
    expect(writes).toEqual([{path: '/runner/output', content: `excerpt<<DELIM_1\n${value}\nDELIM_1\n`}])
  })

  it('mixes single-line and multiline entries, each in its own form', () => {
    const {writes, append} = recorder()
    writeGithubOutputs({excerpt: 'l1\nl2', 'byte-length': '5'}, {onMissing: 'skip', env, append, delimiter: () => 'D'})
    expect(writes[0]?.content).toBe('excerpt<<D\nl1\nl2\nD\nbyte-length=5\n')
  })

  it('asks for a delimiter per multiline entry and none for a single-line one', () => {
    const {append} = recorder()
    const delimiter = vi.fn(() => 'D')
    writeGithubOutputs({a: '1\n2', b: 'plain', c: '3\n4'}, {onMissing: 'skip', env, append, delimiter})
    expect(delimiter).toHaveBeenCalledTimes(2)
  })

  it('uses a UUID delimiter by default, and a fresh one per entry', () => {
    const {writes, append} = recorder()
    writeGithubOutputs({a: '1\n2', b: '3\n4'}, {onMissing: 'skip', env, append})
    const lines = (writes[0]?.content ?? '').split('\n')
    const first = /^a<<(.+)$/u.exec(lines[0] ?? '')?.[1] ?? ''
    const second = /^b<<(.+)$/u.exec(lines[4] ?? '')?.[1] ?? ''
    expect(first).toMatch(UUID_PATTERN)
    expect(second).toMatch(UUID_PATTERN)
    expect(second).not.toBe(first)
    expect(lines[3]).toBe(first)
    expect(lines[7]).toBe(second)
  })

  describe('delimiter collision', () => {
    it('rejects a multiline value that contains the delimiter, and writes nothing', () => {
      const {writes, append} = recorder()
      const options = {onMissing: 'skip', env, append, delimiter: () => 'EOF_1'} as const
      expect(() => writeGithubOutputs({excerpt: 'a\nEOF_1\nb=injected'}, options)).toThrow(
        'GITHUB_OUTPUT value for excerpt contains its delimiter EOF_1',
      )
      expect(writes).toEqual([])
    })

    it('rejects a delimiter embedded in the middle of a line, not only one on its own line', () => {
      const {append} = recorder()
      const options = {onMissing: 'skip', env, append, delimiter: () => 'EOF_1'} as const
      expect(() => writeGithubOutputs({excerpt: 'a\nxxEOF_1xx'}, options)).toThrow('contains its delimiter')
    })

    it('does not reject a value that contains the delimiter when it has no line break', () => {
      const {writes, append} = recorder()
      writeGithubOutputs({note: 'EOF_1'}, {onMissing: 'skip', env, append, delimiter: () => 'EOF_1'})
      expect(writes[0]?.content).toBe('note=EOF_1\n')
    })

    it('writes nothing when a later entry collides, so a partial output never lands', () => {
      const {writes, append} = recorder()
      const options = {onMissing: 'skip', env, append, delimiter: () => 'D'} as const
      expect(() => writeGithubOutputs({ok: 'fine', bad: 'x\nD\ny'}, options)).toThrow('contains its delimiter')
      expect(writes).toEqual([])
    })

    it.each(['', 'has space', 'new\nline', 'a=b', 'a<<b'])('rejects the unsafe delimiter %j', delimiter => {
      const {append} = recorder()
      expect(() =>
        writeGithubOutputs({a: '1\n2'}, {onMissing: 'skip', env, append, delimiter: () => delimiter}),
      ).toThrow('invalid GITHUB_OUTPUT delimiter')
    })
  })

  describe('output names', () => {
    it.each(['a', 'scan_result', 'selected-paths', 'A1', '_x', '9'])('accepts %j', name => {
      const {writes, append} = recorder()
      writeGithubOutputs({[name]: 'v'}, {onMissing: 'skip', env, append})
      expect(writes[0]?.content).toBe(`${name}=v\n`)
    })

    it.each(['', 'has space', 'new\nline', 'a=b', 'a<<b', 'a.b', 'ünï', ' lead', 'trail '])(
      'rejects %j, which could forge another output',
      name => {
        const {writes, append} = recorder()
        expect(() => writeGithubOutputs({[name]: 'v'}, {onMissing: 'skip', env, append})).toThrow(
          'invalid GITHUB_OUTPUT name',
        )
        expect(writes).toEqual([])
      },
    )

    it('validates names even when the file is missing and the policy is skip', () => {
      expect(() => writeGithubOutputs({'bad name': 'v'}, {onMissing: 'skip', env: {}})).toThrow('invalid')
    })
  })

  describe('a missing GITHUB_OUTPUT', () => {
    it.each([
      ['unset', {}],
      ['empty', {GITHUB_OUTPUT: ''}],
      ['undefined', {GITHUB_OUTPUT: undefined}],
    ])('skips when it is %s: nothing is written and the result is false', (_label, missing) => {
      const {writes, append} = recorder()
      expect(writeGithubOutputs({a: '1'}, {onMissing: 'skip', env: missing, append})).toBe(false)
      expect(writes).toEqual([])
    })

    it.each([
      ['unset', {}],
      ['empty', {GITHUB_OUTPUT: ''}],
    ])('throws when it is %s and the policy is throw', (_label, missing) => {
      const {writes, append} = recorder()
      expect(() => writeGithubOutputs({a: '1'}, {onMissing: 'throw', env: missing, append})).toThrow(
        new Error('GITHUB_OUTPUT is required'),
      )
      expect(writes).toEqual([])
    })

    it('throws the caller message when one is given', () => {
      const options = {onMissing: 'throw', env: {}, missingMessage: 'GITHUB_OUTPUT is required in plan mode'} as const
      expect(() => writeGithubOutputs({a: '1'}, options)).toThrow(new Error('GITHUB_OUTPUT is required in plan mode'))
    })

    it('ignores the caller message under skip', () => {
      expect(writeGithubOutputs({a: '1'}, {onMissing: 'skip', env: {}, missingMessage: 'never thrown'})).toBe(false)
    })

    it('does not throw under throw when the variable is set', () => {
      const {append} = recorder()
      expect(writeGithubOutputs({a: '1'}, {onMissing: 'throw', env, append})).toBe(true)
    })
  })

  describe('an unknown policy', () => {
    // The policy is a string at run time, so a value that is neither 'skip' nor 'throw' (a typo, or
    // a variable that was never set) must not quietly behave as one of them.
    it.each([[''], ['Skip'], ['THROW'], ['skipp']])('%j throws, with the variable set or not', policy => {
      const {writes, append} = recorder()
      const options = {onMissing: policy as never, append}
      const expected = new TypeError(`invalid onMissing policy: ${JSON.stringify(policy)}, expected 'skip' or 'throw'`)
      expect(() => writeGithubOutputs({a: '1'}, {...options, env})).toThrow(expected)
      expect(() => writeGithubOutputs({a: '1'}, {...options, env: {}})).toThrow(expected)
      expect(() => appendStepSummary('x', {...options, env: {GITHUB_STEP_SUMMARY: '/s'}})).toThrow(expected)
      expect(writes).toEqual([])
    })

    it('is rejected before a bad entry name is, so the policy is the first thing checked', () => {
      const {append} = recorder()
      expect(() => writeGithubOutputs({'bad name': 'v'}, {onMissing: 'nope' as never, env, append})).toThrow(
        'invalid onMissing policy',
      )
    })
  })

  describe('defaults', () => {
    it('reads process.env when no env is given', () => {
      vi.stubEnv('GITHUB_OUTPUT', '/from/process-env')
      const {writes, append} = recorder()
      writeGithubOutputs({a: '1'}, {onMissing: 'skip', append})
      expect(writes).toEqual([{path: '/from/process-env', content: 'a=1\n'}])
    })

    it('prefers the env option over process.env', () => {
      vi.stubEnv('GITHUB_OUTPUT', '/from/process-env')
      const {writes, append} = recorder()
      writeGithubOutputs({a: '1'}, {onMissing: 'skip', env: {GITHUB_OUTPUT: '/from/option'}, append})
      expect(writes[0]?.path).toBe('/from/option')
    })

    it('treats an unset process.env variable as missing', () => {
      vi.stubEnv('GITHUB_OUTPUT', undefined)
      expect(process.env.GITHUB_OUTPUT).toBeUndefined()
      expect(writeGithubOutputs({a: '1'}, {onMissing: 'skip'})).toBe(false)
    })

    it('appends to a real file, keeping what is already there', () => {
      const directory = mkdtempSync(join(tmpdir(), 'core-output-test-'))
      try {
        const file = join(directory, 'github-output')
        writeFileSync(file, 'existing=1\n')
        writeGithubOutputs({a: '1'}, {onMissing: 'throw', env: {GITHUB_OUTPUT: file}})
        writeGithubOutputs({b: 'x\ny'}, {onMissing: 'throw', env: {GITHUB_OUTPUT: file}, delimiter: () => 'D'})
        expect(readFileSync(file, 'utf8')).toBe('existing=1\na=1\nb<<D\nx\ny\nD\n')
      } finally {
        rmSync(directory, {recursive: true, force: true})
      }
    })
  })
})

describe('appendStepSummary', () => {
  const env = {GITHUB_STEP_SUMMARY: '/runner/summary', GITHUB_OUTPUT: '/runner/output'}

  it('appends the markdown as given to GITHUB_STEP_SUMMARY', () => {
    const {writes, append} = recorder()
    expect(appendStepSummary('## Title\n\n| a |\n', {onMissing: 'skip', env, append})).toBe(true)
    expect(writes).toEqual([{path: '/runner/summary', content: '## Title\n\n| a |\n'}])
  })

  it('writes nothing and returns false for an empty summary', () => {
    const {writes, append} = recorder()
    expect(appendStepSummary('', {onMissing: 'skip', env, append})).toBe(false)
    expect(writes).toEqual([])
  })

  it('does not touch GITHUB_OUTPUT, and writeGithubOutputs does not touch the summary', () => {
    const {writes, append} = recorder()
    appendStepSummary('x', {onMissing: 'skip', env, append})
    writeGithubOutputs({a: '1'}, {onMissing: 'skip', env, append})
    expect(writes.map(write => write.path)).toEqual(['/runner/summary', '/runner/output'])
  })

  it.each([
    ['unset', {}],
    ['empty', {GITHUB_STEP_SUMMARY: ''}],
  ])('skips when it is %s', (_label, missing) => {
    const {writes, append} = recorder()
    expect(appendStepSummary('x', {onMissing: 'skip', env: missing, append})).toBe(false)
    expect(writes).toEqual([])
  })

  it('throws with the variable name by default, or the caller message', () => {
    const base: RunnerFileOptions = {onMissing: 'throw', env: {GITHUB_OUTPUT: '/runner/output'}}
    expect(() => appendStepSummary('x', base)).toThrow(new Error('GITHUB_STEP_SUMMARY is required'))
    expect(() => appendStepSummary('x', {...base, missingMessage: 'no summary'})).toThrow(new Error('no summary'))
  })

  it('reads process.env when no env is given', () => {
    vi.stubEnv('GITHUB_STEP_SUMMARY', '/from/process-env')
    const {writes, append} = recorder()
    appendStepSummary('x', {onMissing: 'skip', append})
    expect(writes).toEqual([{path: '/from/process-env', content: 'x'}])
  })

  it('appends to a real file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'core-summary-test-'))
    try {
      const file = join(directory, 'summary.md')
      writeFileSync(file, 'one\n')
      appendStepSummary('two\n', {onMissing: 'throw', env: {GITHUB_STEP_SUMMARY: file}})
      expect(readFileSync(file, 'utf8')).toBe('one\ntwo\n')
    } finally {
      rmSync(directory, {recursive: true, force: true})
    }
  })
})
