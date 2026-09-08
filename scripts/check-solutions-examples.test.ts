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
  const blocks = extractCodeBlocks(content, docPath)
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

    expect(extractCodeBlocks(content, 'doc.md')).toEqual([
      {docPath: 'doc.md', line: 3, lang: 'ts', code: 'const x = 1', fragment: false, annotations: []},
    ])
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

    const finding = await checkAnnotation(block, soleAnnotation(block), rootDir)
    expect(finding?.symbol).toBe('missingThing')
    expect(finding?.file).toBe('scripts/target.ts')
    expect(finding?.reason).toContain('no function or arrow-function declaration')
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

    const finding = await checkAnnotation(block, soleAnnotation(block), rootDir)
    expect(finding?.symbol).toBe('add')
    expect(finding?.reason).toContain('3 argument(s); real signature accepts 2')
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

    const finding = await checkAnnotation(block, soleAnnotation(block), rootDir)
    expect(finding?.symbol).toBe('add')
    expect(finding?.reason).toContain('1 argument(s); real signature accepts 2')
  })

  it('passes when the call arity matches the real (module-private) signature', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'check-solutions-examples-'))
    await writeFixture(rootDir, 'scripts/target.ts', 'function add(a: number, b: number): number { return a + b }\n')
    const block = soleBlock(
      ['<!-- verify: add from scripts/target.ts -->', '```ts', 'const total = add(1, 2)', '```'].join('\n'),
    )

    const finding = await checkAnnotation(block, soleAnnotation(block), rootDir)
    expect(finding).toBeUndefined()
  })

  it('passes an annotation with no call to the symbol inside the block (existence-only guarantee)', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'check-solutions-examples-'))
    await writeFixture(rootDir, 'scripts/target.ts', 'function add(a: number, b: number): number { return a + b }\n')
    const block = soleBlock(['<!-- verify: add from scripts/target.ts -->', '```ts', 'const x = 1', '```'].join('\n'))

    const finding = await checkAnnotation(block, soleAnnotation(block), rootDir)
    expect(finding).toBeUndefined()
  })

  it('fails when the annotated file does not exist', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'check-solutions-examples-'))
    const block = soleBlock(['<!-- verify: add from scripts/missing.ts -->', '```ts', 'add(1, 2)', '```'].join('\n'))

    const finding = await checkAnnotation(block, soleAnnotation(block), rootDir)
    expect(finding?.reason).toContain('file not found')
  })
})

describe('checkSolutionsExamples', () => {
  it('walks docs/solutions and reports both parse and symbol findings', async () => {
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

    expect(result.blocksChecked).toBe(4)
    expect(result.fragmentsExempted).toBe(1)
    expect(result.parseFindings).toEqual([
      expect.objectContaining({docPath: 'docs/solutions/best-practices/broken-parse.md'}),
    ])
    expect(result.symbolFindings).toEqual([
      expect.objectContaining({docPath: 'docs/solutions/best-practices/wrong-arity.md', symbol: 'add'}),
    ])
  })
})
