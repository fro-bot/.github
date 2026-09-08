import type {CodeBlock, VerifyAnnotation} from './check-solutions-examples.ts'

import {mkdir, mkdtemp, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  checkAnnotation,
  checkBlockParses,
  checkSolutionsExamples,
  extractCodeBlocks,
} from './check-solutions-examples.ts'

async function writeFixture(rootDir: string, relPath: string, content: string): Promise<void> {
  await mkdir(join(rootDir, dirname(relPath)), {recursive: true})
  await writeFile(join(rootDir, relPath), content)
}

/** Extracts the sole block from `content`, failing loudly if the fixture doesn't produce one. */
function soleBlock(content: string, docPath = 'doc.md'): CodeBlock {
  const {blocks} = extractCodeBlocks(content, docPath)
  if (blocks.length !== 1) throw new Error(`expected exactly one code block, got ${String(blocks.length)}`)
  return blocks[0] as CodeBlock
}

/** Extracts the sole `<!-- verify -->` annotation on a block, failing loudly if there isn't one. */
function soleAnnotation(block: CodeBlock): VerifyAnnotation {
  if (block.annotations.length !== 1)
    throw new Error(`expected exactly one annotation, got ${String(block.annotations.length)}`)
  return block.annotations[0] as VerifyAnnotation
}

describe('extractCodeBlocks', () => {
  it('extracts ts/typescript/tsx fenced blocks at their fence line, skipping other languages', () => {
    const content = ['# Title', '', '```ts', 'const x = 1', '```', '', '```yaml', 'a: 1', '```'].join('\n')

    expect(extractCodeBlocks(content, 'doc.md')).toEqual({
      blocks: [{docPath: 'doc.md', line: 3, lang: 'ts', code: 'const x = 1', fragment: false, annotations: []}],
      directiveFindings: [],
    })
  })

  it('marks a block exempt via the `fragment` info-string modifier', () => {
    const block = soleBlock(['```ts fragment', '.filter(x => x)', '```'].join('\n'))
    expect(block.fragment).toBe(true)
  })

  it('collects one or more `<!-- verify -->` annotations immediately above a fence, in source order', () => {
    const content = [
      '<!-- verify: foo from scripts/foo.ts -->',
      '<!-- verify: bar from scripts/bar.ts -->',
      '```ts',
      'foo(1)',
      '```',
    ].join('\n')

    expect(soleBlock(content).annotations).toEqual([
      {symbol: 'foo', file: 'scripts/foo.ts'},
      {symbol: 'bar', file: 'scripts/bar.ts'},
    ])
  })

  it('does not attach an annotation separated from the fence by a blank line', () => {
    const content = ['<!-- verify: foo from scripts/foo.ts -->', '', '```ts', 'foo(1)', '```'].join('\n')
    expect(soleBlock(content).annotations).toEqual([])
  })

  it('finds and dedents a fence indented inside a list item', () => {
    const content = [
      '1. An item:',
      '',
      '   ```ts',
      '   const x: number = 1',
      '   const y = x + 1',
      '   ```',
      '',
      '2. Next item.',
    ].join('\n')

    expect(soleBlock(content)).toMatchObject({line: 3, code: 'const x: number = 1\nconst y = x + 1'})
  })

  describe('malformed directive inputs (reject, not skip)', () => {
    it('reports a fence-shaped comment mentioning verify that is missing the colon', () => {
      const content = ['<!-- verify add from scripts/t.ts -->', '```ts', 'add(1)', '```'].join('\n')
      const {blocks, directiveFindings} = extractCodeBlocks(content, 'doc.md')

      expect(blocks[0]?.annotations).toEqual([])
      expect(directiveFindings).toEqual([expect.objectContaining({docPath: 'doc.md', line: 1})])
    })

    it("reports a typo'd `verify:` keyword (`verifies:`) rather than silently skipping it", () => {
      const content = ['<!-- verifies: add from scripts/t.ts -->', '```ts', 'add(1)', '```'].join('\n')
      const {blocks, directiveFindings} = extractCodeBlocks(content, 'doc.md')

      expect(blocks[0]?.annotations).toEqual([])
      expect(directiveFindings).toHaveLength(1)
      expect(directiveFindings[0]?.reason).toContain("doesn't match that grammar")
    })

    it('reports `in` used instead of `from`', () => {
      const content = ['<!-- verify: add in scripts/t.ts -->', '```ts', 'add(1)', '```'].join('\n')
      const {directiveFindings} = extractCodeBlocks(content, 'doc.md')
      expect(directiveFindings).toHaveLength(1)
    })

    it('reports a fence with two unrecognized modifiers and drops the block entirely', () => {
      const content = ['```ts fragment extra', 'const x = 1', '```'].join('\n')
      const {blocks, directiveFindings} = extractCodeBlocks(content, 'doc.md')

      expect(blocks).toEqual([])
      expect(directiveFindings).toEqual([expect.objectContaining({docPath: 'doc.md', line: 1})])
    })

    it('reports a near-miss language tag as a likely typo', () => {
      const content = ['```typescrpt', 'const x = 1', '```'].join('\n')
      const {blocks, directiveFindings} = extractCodeBlocks(content, 'doc.md')

      expect(blocks).toEqual([])
      expect(directiveFindings).toHaveLength(1)
      expect(directiveFindings[0]?.reason).toContain('typescript')
    })

    it('does not flag a known non-code fence language (no false positives)', () => {
      const content = ['```yaml', 'a: 1', '```', '', '```bash', 'echo hi', '```', '', '```sh', 'echo hi', '```'].join(
        '\n',
      )
      const {directiveFindings} = extractCodeBlocks(content, 'doc.md')
      expect(directiveFindings).toEqual([])
    })

    it('does not flag an unrecognized language that also carries its own modifier (out of scope)', () => {
      const content = ['```python noqa', 'x = 1', '```'].join('\n')
      const {directiveFindings} = extractCodeBlocks(content, 'doc.md')
      expect(directiveFindings).toEqual([])
    })
  })

  describe('multi-line `<!-- verify -->` annotations (CodeQL js/bad-tag-filter regression)', () => {
    it('resolves an annotation wrapped across two lines, normalizing interior whitespace', () => {
      const content = [
        '<!-- verify: guardedPatterns',
        '     from scripts/check-wiki-authority.ts -->',
        '```ts',
        'guardedPatterns()',
        '```',
      ].join('\n')

      const {blocks, directiveFindings} = extractCodeBlocks(content, 'doc.md')
      expect(directiveFindings).toEqual([])
      expect(blocks[0]?.annotations).toEqual([{symbol: 'guardedPatterns', file: 'scripts/check-wiki-authority.ts'}])
    })

    it('still requires the annotation to sit directly above the fence when wrapped', () => {
      const content = ['<!-- verify: foo', '     from scripts/foo.ts -->', '', '```ts', 'foo(1)', '```'].join('\n')

      const {blocks} = extractCodeBlocks(content, 'doc.md')
      expect(blocks[0]?.annotations).toEqual([])
    })

    it('reports a malformed multi-line comment that mentions verify but does not match the grammar', () => {
      const content = ['<!-- verifies: foo', '     from scripts/foo.ts -->', '```ts', 'foo(1)', '```'].join('\n')

      const {blocks, directiveFindings} = extractCodeBlocks(content, 'doc.md')
      expect(blocks[0]?.annotations).toEqual([])
      expect(directiveFindings).toEqual([expect.objectContaining({docPath: 'doc.md', line: 1})])
    })

    it('reports an unterminated `<!--` that looks like a verify annotation instead of swallowing it', () => {
      const content = ['<!-- verify: foo from scripts/foo.ts', '```ts', 'foo(1)', '```'].join('\n')

      const {blocks, directiveFindings} = extractCodeBlocks(content, 'doc.md')
      expect(blocks[0]?.annotations).toEqual([])
      expect(directiveFindings).toHaveLength(1)
      expect(directiveFindings[0]).toMatchObject({docPath: 'doc.md', line: 1})
      expect(directiveFindings[0]?.reason).toContain('never closed')
    })

    it('does not report an unterminated, unrelated HTML comment (no false positive)', () => {
      const content = ['<!-- just a stray note that never closes', '```ts', 'const x = 1', '```'].join('\n')

      const {directiveFindings} = extractCodeBlocks(content, 'doc.md')
      expect(directiveFindings).toEqual([])
    })

    it('still matches an ordinary single-line annotation unchanged', () => {
      const content = ['<!-- verify: foo from scripts/foo.ts -->', '```ts', 'foo(1)', '```'].join('\n')
      const {blocks} = extractCodeBlocks(content, 'doc.md')
      expect(blocks[0]?.annotations).toEqual([{symbol: 'foo', file: 'scripts/foo.ts'}])
    })
  })
})

describe('checkBlockParses', () => {
  it('passes a block that parses as valid TypeScript', () => {
    const block = soleBlock(['```ts', 'const x: number = 1', '```'].join('\n'))
    expect(checkBlockParses(block)).toBeUndefined()
  })

  it('fails a block that does not parse, reporting the doc path and an in-file line number', () => {
    const content = ['# doc', '', '```ts', '.filter(x => x)', '```'].join('\n')
    const finding = checkBlockParses(soleBlock(content))

    expect(finding).toMatchObject({docPath: 'doc.md', line: 4})
  })

  it('skips the parse check entirely for a block marked `fragment`', () => {
    const block = soleBlock(['```ts fragment', '.filter(x => x)', '```'].join('\n'))
    expect(checkBlockParses(block)).toBeUndefined()
  })
})

describe('checkAnnotation', () => {
  it('fails when the annotated file does not export the named symbol', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'check-solutions-examples-'))
    await writeFixture(rootDir, 'scripts/target.ts', 'export function realThing(a: number): number { return a }\n')
    const block = soleBlock(
      ['<!-- verify: missingThing from scripts/target.ts -->', '```ts', 'missingThing(1)', '```'].join('\n'),
    )

    const findings = await checkAnnotation(block, soleAnnotation(block), rootDir)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.symbol).toBe('missingThing')
    expect(findings[0]?.file).toBe('scripts/target.ts')
    expect(findings[0]?.reason).toContain('no function or arrow-function declaration')
  })

  it('fails when a call passes more arguments than the real signature accepts (deliberately wrong arity)', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'check-solutions-examples-'))
    await writeFixture(
      rootDir,
      'scripts/target.ts',
      'export function add(a: number, b: number): number { return a + b }\n',
    )
    const block = soleBlock(
      ['<!-- verify: add from scripts/target.ts -->', '```ts', 'const total = add(1, 2, 3)', '```'].join('\n'),
    )

    const findings = await checkAnnotation(block, soleAnnotation(block), rootDir)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.symbol).toBe('add')
    expect(findings[0]?.reason).toContain('3 argument(s); real signature accepts 2')
  })

  it('fails when a call passes fewer arguments than the real signature requires', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'check-solutions-examples-'))
    await writeFixture(
      rootDir,
      'scripts/target.ts',
      'export function add(a: number, b: number): number { return a + b }\n',
    )
    const block = soleBlock(
      ['<!-- verify: add from scripts/target.ts -->', '```ts', 'const total = add(1)', '```'].join('\n'),
    )

    const findings = await checkAnnotation(block, soleAnnotation(block), rootDir)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.symbol).toBe('add')
    expect(findings[0]?.reason).toContain('1 argument(s); real signature accepts 2')
  })

  it('reports every wrong-arity call in a block, not just the first', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'check-solutions-examples-'))
    await writeFixture(
      rootDir,
      'scripts/target.ts',
      'export function add(a: number, b: number): number { return a + b }\n',
    )
    const block = soleBlock(
      [
        '<!-- verify: add from scripts/target.ts -->',
        '```ts',
        'const a = add(1, 2, 3)',
        'const b = add(1)',
        'const c = add(1, 2, 3, 4)',
        '```',
      ].join('\n'),
    )

    const findings = await checkAnnotation(block, soleAnnotation(block), rootDir)
    expect(findings).toHaveLength(3)
    expect(findings.map(f => f.reason)).toEqual([
      expect.stringContaining('3 argument(s)'),
      expect.stringContaining('1 argument(s)'),
      expect.stringContaining('4 argument(s)'),
    ])
  })

  it('passes when the call arity matches the real (module-private) signature', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'check-solutions-examples-'))
    await writeFixture(rootDir, 'scripts/target.ts', 'function add(a: number, b: number): number { return a + b }\n')
    const block = soleBlock(
      ['<!-- verify: add from scripts/target.ts -->', '```ts', 'const total = add(1, 2)', '```'].join('\n'),
    )

    const findings = await checkAnnotation(block, soleAnnotation(block), rootDir)
    expect(findings).toEqual([])
  })

  it('chooses the top-level declaration, not a nested same-named helper', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'check-solutions-examples-'))
    await writeFixture(
      rootDir,
      'scripts/target.ts',
      [
        'function outer() {',
        '  function add(a: number): number {',
        '    return a',
        '  }',
        '  return add(1)',
        '}',
        '',
        'export function add(a: number, b: number): number { return a + b }',
        '',
        'outer()',
        '',
      ].join('\n'),
    )
    // If the nested one-parameter `add` shadowed the real top-level one, this correct
    // two-argument call would be (incorrectly) flagged as wrong arity.
    const block = soleBlock(
      ['<!-- verify: add from scripts/target.ts -->', '```ts', 'const total = add(1, 2)', '```'].join('\n'),
    )

    const findings = await checkAnnotation(block, soleAnnotation(block), rootDir)
    expect(findings).toEqual([])
  })

  it('passes an annotation with no call to the symbol inside the block (existence-only guarantee)', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'check-solutions-examples-'))
    await writeFixture(rootDir, 'scripts/target.ts', 'function add(a: number, b: number): number { return a + b }\n')
    const block = soleBlock(['<!-- verify: add from scripts/target.ts -->', '```ts', 'const x = 1', '```'].join('\n'))

    const findings = await checkAnnotation(block, soleAnnotation(block), rootDir)
    expect(findings).toEqual([])
  })

  it('fails when the annotated file does not exist', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'check-solutions-examples-'))
    const block = soleBlock(['<!-- verify: add from scripts/missing.ts -->', '```ts', 'add(1, 2)', '```'].join('\n'))

    const findings = await checkAnnotation(block, soleAnnotation(block), rootDir)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.reason).toContain('file not found')
  })

  it('rejects an annotation path that resolves outside the repository root', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'check-solutions-examples-'))
    const block = soleBlock(['<!-- verify: add from ../../../etc/passwd -->', '```ts', 'add(1, 2)', '```'].join('\n'))

    const findings = await checkAnnotation(block, soleAnnotation(block), rootDir)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.reason).toContain('escapes the repository root')
  })
})

describe('checkSolutionsExamples', () => {
  it('walks docs/solutions and reports parse, symbol, and directive findings together', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'check-solutions-examples-'))
    await writeFixture(
      rootDir,
      'scripts/target.ts',
      'export function add(a: number, b: number): number { return a + b }\n',
    )
    await writeFixture(
      rootDir,
      'docs/solutions/best-practices/broken-parse.md',
      ['# Broken parse', '', '```ts', '.filter(x => x)', '```', ''].join('\n'),
    )
    await writeFixture(
      rootDir,
      'docs/solutions/best-practices/wrong-arity.md',
      [
        '# Wrong arity',
        '',
        '<!-- verify: add from scripts/target.ts -->',
        '```ts',
        'const total = add(1, 2, 3)',
        '```',
        '',
      ].join('\n'),
    )
    await writeFixture(
      rootDir,
      'docs/solutions/best-practices/malformed-annotation.md',
      [
        '# Malformed annotation',
        '',
        '<!-- verifies: add from scripts/target.ts -->',
        '```ts',
        'add(1, 2)',
        '```',
        '',
      ].join('\n'),
    )
    await writeFixture(
      rootDir,
      'docs/solutions/best-practices/clean.md',
      [
        '# Clean',
        '',
        '<!-- verify: add from scripts/target.ts -->',
        '```ts',
        'const total = add(1, 2)',
        '```',
        '',
        '```ts fragment',
        '.filter(x => x)',
        '```',
        '',
      ].join('\n'),
    )

    const result = await checkSolutionsExamples(rootDir)

    expect(result.blocksChecked).toBe(5)
    expect(result.fragmentsExempted).toBe(1)
    expect(result.parseFindings).toEqual([
      expect.objectContaining({docPath: 'docs/solutions/best-practices/broken-parse.md'}),
    ])
    expect(result.symbolFindings).toEqual([
      expect.objectContaining({docPath: 'docs/solutions/best-practices/wrong-arity.md', symbol: 'add'}),
    ])
    expect(result.directiveFindings).toEqual([
      expect.objectContaining({docPath: 'docs/solutions/best-practices/malformed-annotation.md'}),
    ])
  })

  it("reproduces the exact PR #3870 regression: a typo'd annotation keyword AND a wrong-arity call in the same block", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'check-solutions-examples-'))
    await writeFixture(
      rootDir,
      'scripts/target.ts',
      'export function add(a: number, b: number): number { return a + b }\n',
    )
    await writeFixture(
      rootDir,
      'docs/solutions/best-practices/regression.md',
      [
        '# Regression',
        '',
        '<!-- verifies: add from scripts/target.ts -->',
        '```ts',
        'const total = add(1, 2, 3)',
        '```',
        '',
      ].join('\n'),
    )

    const result = await checkSolutionsExamples(rootDir)

    // The gate must fail on this input: previously it returned zero findings (exit 0) because
    // the typo'd `verifies:` keyword silently disabled the annotation, so the wrong-arity call
    // was never checked at all.
    expect(
      result.directiveFindings.length + result.parseFindings.length + result.symbolFindings.length,
    ).toBeGreaterThan(0)
    expect(result.directiveFindings).toEqual([
      expect.objectContaining({docPath: 'docs/solutions/best-practices/regression.md'}),
    ])
  })

  it('reproduces the exact CodeQL-flagged regression: a two-line annotation plus a wrong-arity call in the same block', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'check-solutions-examples-'))
    await writeFixture(
      rootDir,
      'scripts/check-wiki-authority.ts',
      'export function guardedPatterns(): readonly RegExp[] { return [] }\n',
    )
    await writeFixture(
      rootDir,
      'docs/solutions/best-practices/multiline-regression.md',
      [
        '# Multi-line regression',
        '',
        '<!-- verify: guardedPatterns',
        '     from scripts/check-wiki-authority.ts -->',
        '```ts',
        'guardedPatterns(1, 2, 3)',
        '```',
        '',
      ].join('\n'),
    )

    const result = await checkSolutionsExamples(rootDir)

    // Before the fix: `content.split('\n')` line-by-line scanning meant a `<!-- verify -->`
    // comment wrapped across two lines never matched the (line-anchored) annotation pattern at
    // all, so the annotation was silently dropped and this 3-argument call against a 0-argument
    // signature was never checked — exit 0.
    expect(result.symbolFindings).toHaveLength(1)
    expect(result.symbolFindings[0]).toMatchObject({
      docPath: 'docs/solutions/best-practices/multiline-regression.md',
      symbol: 'guardedPatterns',
    })
    expect(result.symbolFindings[0]?.reason).toContain('3 argument(s); real signature accepts 0')
    expect(result.directiveFindings).toEqual([])
    expect(result.parseFindings).toEqual([])
  })
})
