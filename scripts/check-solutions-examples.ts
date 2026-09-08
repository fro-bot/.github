import {readdir, readFile} from 'node:fs/promises'
/**
 * Verifies TypeScript code examples embedded in `docs/solutions/**\/*.md`.
 *
 * `scripts/solutions-query.ts` injects these docs verbatim into agent prompts, so a fenced
 * example that is subtly wrong — syntactically broken, or naming a repo symbol that no longer
 * exists or is called with the wrong number of arguments — teaches the opposite of what the
 * prose claims and nothing else catches it (see PR #3868, where `source.url === expectedUrl`
 * was presented as the vulnerable line despite `===` doing no coercion).
 *
 * Two independent checks, run over every ` ```ts `/` ```typescript `/` ```tsx ` fenced block
 * (indented fences — e.g. inside a list item — are matched and dedented before parsing, so
 * list-nested examples get real coverage rather than being silently skipped):
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
 *
 * Both directive forms (the `<!-- verify -->` comment and the fence's own info string) fail
 * CLOSED on anything that looks like it was meant to be a directive but doesn't parse as one —
 * a typo'd `verify:` keyword, a fence with more than one unrecognized modifier, or a
 * near-miss language tag — is reported as a `directiveFindings` entry rather than silently
 * skipped. A gate that stays green on unrecognized input is exactly the failure mode this
 * script exists to close (see PR #3870).
 */
import {isAbsolute, join, relative, resolve} from 'node:path'
import process from 'node:process'

import ts from 'typescript'

const SOLUTIONS_ROOT = 'docs/solutions'
const CODE_LANGS = new Set(['ts', 'typescript', 'tsx'])
const FRAGMENT_MODIFIER = 'fragment'
// Every non-code fence language actually used in docs/solutions today, so the near-miss
// language-tag check below never flags a legitimate tag as a typo of `ts`/`typescript`/`tsx`.
const KNOWN_NON_CODE_FENCE_LANGS = new Set(['yaml', 'bash', 'sh', 'text', 'markdown', 'json5', 'json', 'diff'])
// A fence's info string is only worth comparing against CODE_LANGS when it's short enough that
// a real near-miss (one or two typo'd characters) is plausible — bounds the cost of comparing
// against a long, unrelated word.
const NEAR_MISS_MAX_DISTANCE = 2

export interface CodeBlock {
  /** Repository-relative path of the markdown file containing the block. */
  readonly docPath: string
  /** 1-based line number of the block's opening fence. */
  readonly line: number
  readonly lang: string
  /** Fence content, dedented by the opening fence's own indentation. */
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

/**
 * A directive-shaped input (a `<!-- verify -->`-looking comment, or a fence whose info string
 * starts with a recognized language) that failed to parse as a real directive. Reported as an
 * error rather than silently ignored — see the module docstring.
 */
export interface DirectiveFinding {
  readonly docPath: string
  readonly line: number
  readonly reason: string
}

export interface ExtractResult {
  readonly blocks: readonly CodeBlock[]
  readonly directiveFindings: readonly DirectiveFinding[]
}

export interface CheckResult {
  readonly blocksChecked: number
  readonly fragmentsExempted: number
  readonly parseFindings: readonly ParseFinding[]
  readonly symbolFindings: readonly SymbolFinding[]
  readonly directiveFindings: readonly DirectiveFinding[]
}

// Matches an HTML comment's full text, INCLUDING one that spans multiple lines, via `[\s\S]`
// rather than `.` (which never matches a newline) — CodeQL's "Bad HTML filtering regexp" query
// correctly flagged an earlier line-anchored `.`-based version of this pattern for exactly this
// gap: a `<!-- verify: ... -->` annotation wrapped across two lines silently failed to match
// and was never checked at all (see PR #3870's second review round). The lazy `*?` stops at the
// FIRST `-->`, so back-to-back comments on adjacent lines are still matched as separate spans.
const COMMENT_SPAN_PATTERN = /<!--([\s\S]*?)-->/gu
const COMMENT_OPEN_PATTERN = /<!--/gu
// Case-insensitive prefix match, not a literal "verify" substring check: catches "verifies:",
// "Verify:", and any other verify*/verifying variant ("verifies" does NOT contain "verify" as a
// substring — it diverges right before the final "y" — so a literal substring check misses it).
const VERIFY_LIKE_PATTERN = /\bverif\w*/iu
const VERIFY_ANNOTATION_INNER_PATTERN = /^verify:\s*(\S+)\s+from\s+(\S+)$/u
// Deliberately loose: captures ANY fence line (any indent, any info string, including empty
// or malformed), so every fence-shaped line gets a chance to be validated rather than silently
// falling through when it doesn't match a stricter pattern.
const FENCE_LINE_PATTERN = /^(\s*)```(.*)$/u
const FENCE_CLOSE_PATTERN = /^\s*```\s*$/u

interface CommentSpan {
  /** 1-based line the `<!--` opens on. */
  readonly startLine: number
  /** 1-based line the matching `-->` closes on (equals `startLine` for a single-line comment). */
  readonly endLine: number
  /** Raw text between the delimiters, newlines and all. */
  readonly inner: string
}

/** 1-based line number containing byte offset `index` into `content`. */
function lineNumberAt(content: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i++) {
    if (content[i] === '\n') line += 1
  }
  return line
}

/**
 * Finds every HTML comment span in `content`, multi-line ones included, plus every `<!--` that
 * never finds a matching `-->` before EOF (which the lazy `COMMENT_SPAN_PATTERN` scan, correctly,
 * does not consume). An unterminated comment must not be silently swallowed — it is reported by
 * the caller when it looks like an annotation.
 */
interface UnterminatedComment {
  readonly line: number
  readonly index: number
}

function findCommentSpans(content: string): {
  readonly spans: readonly CommentSpan[]
  readonly unterminated: readonly UnterminatedComment[]
} {
  const spans: CommentSpan[] = []
  const consumedRanges: {readonly start: number; readonly end: number}[] = []

  for (const match of content.matchAll(COMMENT_SPAN_PATTERN)) {
    const start = match.index
    const end = start + match[0].length
    consumedRanges.push({start, end})
    spans.push({
      startLine: lineNumberAt(content, start),
      endLine: lineNumberAt(content, end - 1),
      inner: match[1] ?? '',
    })
  }

  const unterminated: UnterminatedComment[] = []
  for (const openMatch of content.matchAll(COMMENT_OPEN_PATTERN)) {
    const index = openMatch.index
    const covered = consumedRanges.some(range => index >= range.start && index < range.end)
    if (!covered) unterminated.push({line: lineNumberAt(content, index), index})
  }

  return {spans, unterminated}
}

/** Collapses a (possibly multi-line) comment body to single-spaced text for grammar matching. */
function normalizeCommentInner(inner: string): string {
  return inner.replaceAll(/\s+/gu, ' ').trim()
}

/** Extracts every fenced code block from a markdown document's raw text. */
export function extractCodeBlocks(content: string, docPath: string): ExtractResult {
  const lines = content.split('\n')
  const blocks: CodeBlock[] = []
  const directiveFindings: DirectiveFinding[] = []

  const {spans, unterminated} = findCommentSpans(content)
  const spansByEndLine = new Map(spans.map(span => [span.endLine, span]))
  for (const comment of unterminated) {
    // Only the text up to the next 4KB (or EOF) is worth scanning for "looks like an
    // annotation" — an unterminated `<!--` this script cares about names a `verify` directive
    // near its own opening line, not an arbitrarily distant, unrelated closing tag.
    const tail = content.slice(comment.index, comment.index + 4096)
    if (VERIFY_LIKE_PATTERN.test(tail)) {
      directiveFindings.push({
        docPath,
        line: comment.line,
        reason:
          'HTML comment opened with `<!--` here is never closed with `-->` before EOF (or the next 4KB) — looks like an unterminated `<!-- verify: ... -->` annotation',
      })
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const openMatch = FENCE_LINE_PATTERN.exec(lines[i] ?? '')
    if (!openMatch) continue

    const indent = openMatch[1] ?? ''
    const infoString = (openMatch[2] ?? '').trim()
    // Split on the first whitespace run rather than a second regex group sharing a wildcard
    // with the info string's remainder — two adjacent variable-length quantifiers over
    // overlapping character classes is exactly the shape `regexp/no-super-linear-backtracking`
    // (correctly) flags.
    const spaceIndex = infoString.search(/\s/u)
    const rawLang = spaceIndex === -1 ? infoString : infoString.slice(0, spaceIndex)
    const lang = rawLang.toLowerCase()
    const rest = spaceIndex === -1 ? '' : infoString.slice(spaceIndex).trim()
    const fenceLine = i + 1

    const bodyLines: string[] = []
    let j = i + 1
    for (; j < lines.length; j++) {
      if (FENCE_CLOSE_PATTERN.test(lines[j] ?? '')) break
      bodyLines.push(dedent(lines[j] ?? '', indent))
    }

    if (CODE_LANGS.has(lang)) {
      const modifierTokens = rest.length === 0 ? [] : rest.split(/\s+/u)
      const {annotations, findings: annotationFindings} = collectAnnotationsAt(spansByEndLine, fenceLine)
      for (const finding of annotationFindings) directiveFindings.push({...finding, docPath})

      if (modifierTokens.length === 0) {
        blocks.push({docPath, line: fenceLine, lang, code: bodyLines.join('\n'), fragment: false, annotations})
      } else if (modifierTokens.length === 1 && modifierTokens[0] === FRAGMENT_MODIFIER) {
        blocks.push({docPath, line: fenceLine, lang, code: bodyLines.join('\n'), fragment: true, annotations})
      } else {
        directiveFindings.push({
          docPath,
          line: fenceLine,
          reason: `unrecognized fence modifier "${rest}" on a \`${rawLang}\` fence (only the bare fence or a single \`${FRAGMENT_MODIFIER}\` modifier is recognized) — block was not checked`,
        })
      }
    } else if (rest.length === 0 && rawLang.length > 0 && !KNOWN_NON_CODE_FENCE_LANGS.has(lang)) {
      const nearestMatch = nearestCodeLang(lang)
      if (nearestMatch !== undefined) {
        directiveFindings.push({
          docPath,
          line: fenceLine,
          reason: `fence language "${rawLang}" is not recognized and closely resembles "${nearestMatch}" — likely a typo (block was not checked as TypeScript)`,
        })
      }
    }

    i = j // skip past the closing fence; outer loop's i++ advances past it
  }

  return {blocks, directiveFindings}
}

/** Strips up to `indent`'s length of leading whitespace from `line`, tolerating a shorter prefix. */
function dedent(line: string, indent: string): string {
  if (indent.length === 0) return line
  if (line.startsWith(indent)) return line.slice(indent.length)
  const leading = /^\s*/u.exec(line)?.[0] ?? ''
  return line.slice(Math.min(leading.length, indent.length))
}

/** The nearest `CODE_LANGS` member to `lang` within `NEAR_MISS_MAX_DISTANCE` edits, if any. */
function nearestCodeLang(lang: string): string | undefined {
  let best: {readonly candidate: string; readonly distance: number} | undefined
  for (const candidate of CODE_LANGS) {
    const distance = levenshteinDistance(lang, candidate)
    if (distance > 0 && distance <= NEAR_MISS_MAX_DISTANCE && (!best || distance < best.distance)) {
      best = {candidate, distance}
    }
  }
  return best?.candidate
}

function levenshteinDistance(a: string, b: string): number {
  let previousRow = Array.from({length: b.length + 1}, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const currentRow: number[] = Array.from({length: b.length + 1}, () => 0)
    currentRow[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const deletion = (previousRow[j] ?? 0) + 1
      const insertion = (currentRow[j - 1] ?? 0) + 1
      const substitution = (previousRow[j - 1] ?? 0) + cost
      currentRow[j] = Math.min(deletion, insertion, substitution)
    }
    previousRow = currentRow
  }
  return previousRow[b.length] ?? 0
}

/**
 * Walks upward from the fence line collecting contiguous `<!-- verify: ... -->` comments —
 * contiguous by LINE, not by raw source line: a comment span's `endLine`/`startLine` already
 * account for it having consumed one or more physical lines, so a two-line annotation
 * immediately above the fence is exactly one "step" of this walk, and a comment plus a
 * following blank line still breaks contiguity (an annotation must sit directly above the
 * fence). Stops at the first comment that doesn't match the annotation grammar. One that
 * mentions `verify` but doesn't match it is reported as a `DirectiveFinding` rather than
 * silently skipped, and also stops the walk — a malformed directive is exactly the kind of
 * comment a reader (or a script) should not read past as if it weren't there. A comment
 * unrelated to `verify` stops the walk silently, same as before.
 */
interface RawDirectiveFinding {
  readonly line: number
  readonly reason: string
}

function collectAnnotationsAt(
  spansByEndLine: ReadonlyMap<number, CommentSpan>,
  fenceLine: number,
): {readonly annotations: readonly VerifyAnnotation[]; readonly findings: readonly RawDirectiveFinding[]} {
  const annotations: VerifyAnnotation[] = []
  const findings: RawDirectiveFinding[] = []
  let expectedEndLine = fenceLine - 1

  for (;;) {
    const span = spansByEndLine.get(expectedEndLine)
    if (!span) break

    const normalized = normalizeCommentInner(span.inner)
    const verifyMatch = VERIFY_ANNOTATION_INNER_PATTERN.exec(normalized)
    if (verifyMatch) {
      annotations.unshift({symbol: verifyMatch[1] ?? '', file: verifyMatch[2] ?? ''})
      expectedEndLine = span.startLine - 1
      continue
    }

    if (VERIFY_LIKE_PATTERN.test(normalized)) {
      findings.push({
        line: span.startLine,
        reason: `comment looks like a \`<!-- verify: NAME from PATH -->\` annotation but doesn't match that grammar: <!--${span.inner}-->`,
      })
    }
    break
  }

  return {annotations, findings}
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

/**
 * Finds the top-level function/arrow-function declaration named `symbol` in `sourceFile`.
 * Deliberately restricted to `sourceFile.statements` (not a full-tree walk): a nested helper
 * that happens to share a name with the intended top-level symbol must never shadow it.
 */
function findSignature(sourceFile: ts.SourceFile, symbol: string): ResolvedSignature | undefined {
  let found: readonly ts.ParameterDeclaration[] | undefined

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === symbol) {
      found = statement.parameters
      break
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== symbol) continue
        const initializer = declaration.initializer
        if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
          found = initializer.parameters
          break
        }
      }
    }
    if (found) break
  }

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

/** True iff `candidateRelativePath`, resolved against `rootDir`, stays within `rootDir`. */
function resolvesWithinRoot(rootDir: string, candidateRelativePath: string): boolean {
  const resolvedRoot = resolve(rootDir)
  const resolvedCandidate = resolve(rootDir, candidateRelativePath)
  const rel = relative(resolvedRoot, resolvedCandidate)
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Checks one `<!-- verify -->` annotation against a block: the named symbol must exist in the
 * named repo-relative file, and every call to it inside the block must pass an argument count
 * the real signature accepts. A block with no calls to the symbol still passes (b) vacuously —
 * the annotation's minimum guarantee is that the symbol exists. Returns every violation found,
 * not just the first, so a block with several wrong-arity calls is reported in one pass.
 */
export async function checkAnnotation(
  block: CodeBlock,
  annotation: VerifyAnnotation,
  rootDir: string,
): Promise<readonly SymbolFinding[]> {
  if (!resolvesWithinRoot(rootDir, annotation.file)) {
    return [
      {
        docPath: block.docPath,
        line: block.line,
        symbol: annotation.symbol,
        file: annotation.file,
        reason: `annotation file path escapes the repository root: ${annotation.file}`,
      },
    ]
  }

  let content: string
  try {
    content = await readFile(join(rootDir, annotation.file), 'utf8')
  } catch {
    return [
      {
        docPath: block.docPath,
        line: block.line,
        symbol: annotation.symbol,
        file: annotation.file,
        reason: `file not found: ${annotation.file}`,
      },
    ]
  }

  const sourceFile = ts.createSourceFile(annotation.file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const signature = findSignature(sourceFile, annotation.symbol)
  if (!signature) {
    return [
      {
        docPath: block.docPath,
        line: block.line,
        symbol: annotation.symbol,
        file: annotation.file,
        reason: `no function or arrow-function declaration named "${annotation.symbol}" found in ${annotation.file}`,
      },
    ]
  }

  const findings: SymbolFinding[] = []
  for (const call of findCalls(block.code, annotation.symbol)) {
    if (call.hasSpread) continue // argument count cannot be determined statically
    if (call.argCount < signature.minArgs || call.argCount > signature.maxArgs) {
      const expected =
        signature.minArgs === signature.maxArgs
          ? `${String(signature.minArgs)}`
          : `${String(signature.minArgs)}-${signature.maxArgs === Number.POSITIVE_INFINITY ? '∞' : String(signature.maxArgs)}`
      findings.push({
        docPath: block.docPath,
        line: block.line + call.line + 1,
        symbol: annotation.symbol,
        file: annotation.file,
        reason: `doc calls ${annotation.symbol} with ${String(call.argCount)} argument(s); real signature accepts ${expected}`,
      })
    }
  }

  return findings
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
  const directiveFindings: DirectiveFinding[] = []
  let blocksChecked = 0
  let fragmentsExempted = 0

  for (const docPath of docPaths) {
    const content = await readFile(join(rootDir, docPath), 'utf8')
    const {blocks, directiveFindings: docDirectiveFindings} = extractCodeBlocks(content, docPath)
    directiveFindings.push(...docDirectiveFindings)

    for (const block of blocks) {
      blocksChecked += 1
      if (block.fragment) fragmentsExempted += 1

      const parseFinding = checkBlockParses(block)
      if (parseFinding) parseFindings.push(parseFinding)

      for (const annotation of block.annotations) {
        const findings = await checkAnnotation(block, annotation, rootDir)
        symbolFindings.push(...findings)
      }
    }
  }

  return {blocksChecked, fragmentsExempted, parseFindings, symbolFindings, directiveFindings}
}

export async function main(): Promise<void> {
  const result = await checkSolutionsExamples()

  for (const finding of result.directiveFindings) {
    process.stderr.write(`${finding.docPath}:${String(finding.line)} -> ${finding.reason}\n`)
  }
  for (const finding of result.parseFindings) {
    process.stderr.write(`${finding.docPath}:${String(finding.line)} -> ${finding.message}\n`)
  }
  for (const finding of result.symbolFindings) {
    process.stderr.write(
      `${finding.docPath}:${String(finding.line)} -> [${finding.symbol} in ${finding.file}] ${finding.reason}\n`,
    )
  }

  if (result.directiveFindings.length > 0 || result.parseFindings.length > 0 || result.symbolFindings.length > 0) {
    process.exitCode = 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
