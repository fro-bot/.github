/**
 * Verifies TypeScript code examples embedded in `docs/solutions/**\/*.md`.
 *
 * `scripts/solutions-query.ts` injects these docs verbatim into agent prompts, so a fenced
 * example that is subtly wrong — syntactically broken, or naming a repo symbol that no longer
 * exists or is called with the wrong number of arguments — teaches the opposite of what the
 * prose claims and nothing else catches it (see PR #3868, where `source.url === expectedUrl`
 * was presented as the vulnerable line despite `===` doing no coercion).
 *
 * Two independent checks, run over every ` ```ts `/` ```typescript `/` ```tsx ` fenced block:
 *
 * 1. **Parse.** Every block must parse as valid TypeScript (checked via the TypeScript
 *    compiler API's syntactic diagnostics — no type information is required or used). Most
 *    blocks that cannot parse as written are deliberate fragments (a bare `.filter(...)`
 *    continuation, a `{ ... }` elision, a dangling `catch`) and should be rewritten to parse
 *    rather than exempted — a fragment that parses is strictly more useful to a reader than one
 *    that doesn't. For the rare block that genuinely cannot parse as valid TS and still teach
 *    the point, suffix the fence's info string with `fragment` (e.g. ` ```ts fragment `) to skip
 *    the parse check. This is a LAST RESORT: prefer rewriting the fragment to parse.
 *
 * 2. **Symbol/arity (opt-in).** A block preceded immediately by one or more
 *    `<!-- verify: NAME from PATH -->` HTML comments has each named export resolved in the
 *    repo-relative `PATH` file, and every call to `NAME` inside the block is checked against
 *    that symbol's real parameter count. This is opt-in because most blocks are illustrative
 *    and name nothing real; only annotate a block when it names or calls an actual repo symbol.
 */
import {readdir, readFile} from 'node:fs/promises'
import {join, relative} from 'node:path'
import process from 'node:process'

import ts from 'typescript'

const SOLUTIONS_ROOT = 'docs/solutions'
const CODE_LANGS = new Set(['ts', 'typescript', 'tsx'])
const FRAGMENT_MODIFIER = 'fragment'

export interface CodeBlock {
  /** Repository-relative path of the markdown file containing the block. */
  readonly docPath: string
  /** 1-based line number of the block's opening fence. */
  readonly line: number
  readonly lang: string
  readonly code: string
  /** True when the fence's info string carries the `fragment` escape (skips the parse check). */
  readonly fragment: boolean
  /** `<!-- verify: NAME from PATH -->` annotations immediately above the fence, if any. */
  readonly annotations: readonly VerifyAnnotation[]
}

export interface VerifyAnnotation {
  readonly symbol: string
  /** Repo-relative path to the file the symbol is declared in. */
  readonly file: string
}

export interface ParseFinding {
  readonly docPath: string
  readonly line: number
  readonly message: string
}

export interface SymbolFinding {
  readonly docPath: string
  readonly line: number
  readonly symbol: string
  readonly file: string
  readonly reason: string
}

export interface CheckResult {
  readonly blocksChecked: number
  readonly fragmentsExempted: number
  readonly parseFindings: readonly ParseFinding[]
  readonly symbolFindings: readonly SymbolFinding[]
}

const VERIFY_ANNOTATION_PATTERN = /^<!--\s*verify:\s*(\S+)\s+from\s+(\S+)\s*-->$/u
const FENCE_OPEN_PATTERN = /^```([\w-]+)(?:\s+(\S+))?\s*$/u
const FENCE_CLOSE_PATTERN = /^```\s*$/u

/** Extracts every fenced code block from a markdown document's raw text. */
export function extractCodeBlocks(content: string, docPath: string): CodeBlock[] {
  const lines = content.split('\n')
  const blocks: CodeBlock[] = []

  for (let i = 0; i < lines.length; i++) {
    const openMatch = FENCE_OPEN_PATTERN.exec(lines[i] ?? '')
    if (!openMatch) continue

    const lang = openMatch[1] ?? ''
    const modifier = openMatch[2]
    const fenceLine = i + 1
    const bodyLines: string[] = []
    let j = i + 1
    for (; j < lines.length; j++) {
      if (FENCE_CLOSE_PATTERN.test(lines[j] ?? '')) break
      bodyLines.push(lines[j] ?? '')
    }

    if (CODE_LANGS.has(lang)) {
      blocks.push({
        docPath,
        line: fenceLine,
        lang,
        code: bodyLines.join('\n'),
        fragment: modifier === FRAGMENT_MODIFIER,
        annotations: collectAnnotations(lines, i),
      })
    }

    i = j // skip past the closing fence; outer loop's i++ advances past it
  }

  return blocks
}

/** Walks upward from the fence line collecting contiguous `<!-- verify: ... -->` comments. */
function collectAnnotations(lines: readonly string[], fenceIndex: number): VerifyAnnotation[] {
  const annotations: VerifyAnnotation[] = []
  let k = fenceIndex - 1
  while (k >= 0) {
    const match = VERIFY_ANNOTATION_PATTERN.exec((lines[k] ?? '').trim())
    if (!match) break
    annotations.unshift({symbol: match[1] ?? '', file: match[2] ?? ''})
    k -= 1
  }
  return annotations
}

/**
 * Parses `code` as a standalone TypeScript/TSX source file and returns its syntactic
 * diagnostics (never semantic/type diagnostics — a fragment is not expected to type-check,
 * only to parse).
 */
function collectSyntacticDiagnostics(code: string, lang: string): readonly ts.DiagnosticWithLocation[] {
  const scriptKind = lang === 'tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const fileName = lang === 'tsx' ? 'block.tsx' : 'block.ts'
  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, scriptKind)
  const options: ts.CompilerOptions = {
    noEmit: true,
    allowJs: true,
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.Latest,
  }
  const host: ts.CompilerHost = {
    getSourceFile: name => (name === fileName ? sourceFile : undefined),
    writeFile: () => {},
    getDefaultLibFileName: () => 'lib.d.ts',
    useCaseSensitiveFileNames: () => true,
    getCanonicalFileName: name => name,
    getCurrentDirectory: () => '',
    getNewLine: () => '\n',
    fileExists: name => name === fileName,
    readFile: () => undefined,
    directoryExists: () => true,
    getDirectories: () => [],
  }
  const program = ts.createProgram([fileName], options, host)
  return program.getSyntacticDiagnostics(sourceFile)
}

/** Checks a single block's parse validity. Returns a finding iff the block fails to parse. */
export function checkBlockParses(block: CodeBlock): ParseFinding | undefined {
  if (block.fragment) return undefined

  const diagnostics = collectSyntacticDiagnostics(block.code, block.lang)
  const first = diagnostics[0]
  if (!first) return undefined

  const {line} = first.file.getLineAndCharacterOfPosition(first.start)
  const message = ts.flattenDiagnosticMessageText(first.messageText, ' ')
  return {docPath: block.docPath, line: block.line + line + 1, message}
}

interface ResolvedSignature {
  readonly minArgs: number
  readonly maxArgs: number
}

/** Finds the first function/arrow-function declaration named `symbol` anywhere in `sourceFile`. */
function findSignature(sourceFile: ts.SourceFile, symbol: string): ResolvedSignature | undefined {
  let found: readonly ts.ParameterDeclaration[] | undefined

  const visit = (node: ts.Node): void => {
    if (found) return
    if (ts.isFunctionDeclaration(node) && node.name?.text === symbol) {
      found = node.parameters
      return
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === symbol) {
      const initializer = node.initializer
      if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
        found = initializer.parameters
        return
      }
    }
    ts.forEachChild(node, visit)
  }

  ts.forEachChild(sourceFile, visit)
  if (!found) return undefined

  let minArgs = 0
  let maxArgs = 0
  let hasRest = false
  for (const param of found) {
    if (param.dotDotDotToken) {
      hasRest = true
      continue
    }
    const optional = param.questionToken !== undefined || param.initializer !== undefined
    if (!optional) minArgs += 1
    maxArgs += 1
  }
  return {minArgs, maxArgs: hasRest ? Number.POSITIVE_INFINITY : maxArgs}
}

/** Every `CallExpression` inside `code` whose callee is a bare identifier named `symbol`. */
function findCalls(code: string, symbol: string): {line: number; argCount: number; hasSpread: boolean}[] {
  const sourceFile = ts.createSourceFile('block.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const calls: {line: number; argCount: number; hasSpread: boolean}[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === symbol) {
      const {line} = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
      calls.push({
        line,
        argCount: node.arguments.length,
        hasSpread: node.arguments.some(arg => ts.isSpreadElement(arg)),
      })
    }
    ts.forEachChild(node, visit)
  }

  ts.forEachChild(sourceFile, visit)
  return calls
}

/**
 * Checks one `<!-- verify -->` annotation against a block: the named symbol must exist in the
 * named repo-relative file, and every call to it inside the block must pass an argument count
 * the real signature accepts. A block with no calls to the symbol still passes (b) vacuously —
 * the annotation's minimum guarantee is that the symbol exists.
 */
export async function checkAnnotation(
  block: CodeBlock,
  annotation: VerifyAnnotation,
  rootDir: string,
): Promise<SymbolFinding | undefined> {
  let content: string
  try {
    content = await readFile(join(rootDir, annotation.file), 'utf8')
  } catch {
    return {
      docPath: block.docPath,
      line: block.line,
      symbol: annotation.symbol,
      file: annotation.file,
      reason: `file not found: ${annotation.file}`,
    }
  }

  const sourceFile = ts.createSourceFile(annotation.file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const signature = findSignature(sourceFile, annotation.symbol)
  if (!signature) {
    return {
      docPath: block.docPath,
      line: block.line,
      symbol: annotation.symbol,
      file: annotation.file,
      reason: `no function or arrow-function declaration named "${annotation.symbol}" found in ${annotation.file}`,
    }
  }

  for (const call of findCalls(block.code, annotation.symbol)) {
    if (call.hasSpread) continue // argument count cannot be determined statically
    if (call.argCount < signature.minArgs || call.argCount > signature.maxArgs) {
      const expected =
        signature.minArgs === signature.maxArgs
          ? `${String(signature.minArgs)}`
          : `${String(signature.minArgs)}-${signature.maxArgs === Number.POSITIVE_INFINITY ? '∞' : String(signature.maxArgs)}`
      return {
        docPath: block.docPath,
        line: block.line + call.line + 1,
        symbol: annotation.symbol,
        file: annotation.file,
        reason: `doc calls ${annotation.symbol} with ${String(call.argCount)} argument(s); real signature accepts ${expected}`,
      }
    }
  }

  return undefined
}

async function collectSolutionsMarkdownPaths(rootDir: string): Promise<string[]> {
  const paths: string[] = []
  await collectUnder(join(rootDir, SOLUTIONS_ROOT), rootDir, paths)
  return paths.sort()
}

async function collectUnder(directory: string, rootDir: string, paths: string[]): Promise<void> {
  let entries
  try {
    entries = await readdir(directory, {withFileTypes: true})
  } catch (error: unknown) {
    if (isErrorWithCode(error, 'ENOENT')) return
    throw error
  }

  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await collectUnder(path, rootDir, paths)
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      paths.push(relative(rootDir, path).replaceAll('\\', '/'))
    }
  }
}

function isErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

/** Checks every `docs/solutions/**\/*.md` code example. Exported for testing. */
export async function checkSolutionsExamples(rootDir: string = process.cwd()): Promise<CheckResult> {
  const docPaths = await collectSolutionsMarkdownPaths(rootDir)
  const parseFindings: ParseFinding[] = []
  const symbolFindings: SymbolFinding[] = []
  let blocksChecked = 0
  let fragmentsExempted = 0

  for (const docPath of docPaths) {
    const content = await readFile(join(rootDir, docPath), 'utf8')
    for (const block of extractCodeBlocks(content, docPath)) {
      blocksChecked += 1
      if (block.fragment) fragmentsExempted += 1

      const parseFinding = checkBlockParses(block)
      if (parseFinding) parseFindings.push(parseFinding)

      for (const annotation of block.annotations) {
        const symbolFinding = await checkAnnotation(block, annotation, rootDir)
        if (symbolFinding) symbolFindings.push(symbolFinding)
      }
    }
  }

  return {blocksChecked, fragmentsExempted, parseFindings, symbolFindings}
}

export async function main(): Promise<void> {
  const result = await checkSolutionsExamples()

  for (const finding of result.parseFindings) {
    process.stderr.write(`${finding.docPath}:${String(finding.line)} -> ${finding.message}\n`)
  }
  for (const finding of result.symbolFindings) {
    process.stderr.write(
      `${finding.docPath}:${String(finding.line)} -> [${finding.symbol} in ${finding.file}] ${finding.reason}\n`,
    )
  }

  if (result.parseFindings.length > 0 || result.symbolFindings.length > 0) {
    process.exitCode = 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
