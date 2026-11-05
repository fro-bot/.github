// Every alternative form a pure re-export statement can take. Deliberately mirrors what
// `directSpecifiers` (./check-mutation-guards.ts) already recognizes as a re-export, so a
// module this pattern fails to strip is exactly a module `directSpecifiers` would also treat
// as carrying no reach-worthy specifier of its own (has none of the forms it looks for).
// The two brace forms match only their opening here: `stripBarrelExports` finds the closing
// brace and the `from` clause itself, because `\{[^}]*\}` rescans to the same `}` from every
// `{` and is quadratic on a file of unclosed braces.
// A function rather than a module-level const, so its regex mutants are covered by the barrel
// tests alone instead of being static mutants that run every test file.
function barrelExportHeadPattern(): RegExp {
  return /export\s+(?:type\s+)?\*\s+(?:as\s+[$\w]+\s+)?from\s+['"][^'"]+['"]\s*;?|export\s+type\s*\{|export\s*\{/gu
}

/** What must follow the closing brace of an `export {...}` or `export type {...}` statement. */
function barrelFromClausePattern(): RegExp {
  return /\s*from\s+['"][^'"]+['"]\s*;?/uy
}

/**
 * The index in `sorted` of the first element that is at least `target`, or `sorted.length` when there is none. A binary
 * search written as a recursion: a wrong bound recurses until the stack overflows, which is an error at once, not a hang.
 */
export function firstAtOrAfter(sorted: readonly number[], target: number, low = 0, high = sorted.length): number {
  if (low >= high) return low
  const middle = (low + high) >>> 1
  return Number(sorted[middle]) < target
    ? firstAtOrAfter(sorted, target, middle + 1, high)
    : firstAtOrAfter(sorted, target, low, middle)
}

/**
 * `content` with every barrel export statement removed, in time linear in `content`. It returns what
 * `content.replaceAll(/<the three forms>/gu, '')` returns, where a brace form is
 * `export\s+type\s*\{[^}]*\}\s*from\s+['"][^'"]+['"]\s*;?` or `export\s*\{[^}]*\}\s*from\s+['"][^'"]+['"]\s*;?`.
 *
 * The `}` that closes a brace head is the first one after it, so every head before the same `}` has the same `from`
 * clause or lacks it alike. The clause after each `}` is therefore tried once, up front, and a head looks its close up in
 * the ordered list of closes. A head inside a statement that was already removed is skipped, as the engine resumes after
 * the statement; a head that fails removes nothing, and no head starts inside another's text, so the engine's retry
 * one character on finds the same next head.
 */
export function stripBarrelExports(content: string): string {
  const closes = Array.from(content.matchAll(/\}/gu), close => close.index)
  const fromClause = barrelFromClausePattern()
  const clauseEnds = closes.map(close => {
    fromClause.lastIndex = close + 1
    const clause = fromClause.exec(content)
    return clause === null ? undefined : close + 1 + clause[0].length
  })
  let result = ''
  let copied = 0
  for (const head of content.matchAll(barrelExportHeadPattern())) {
    if (head.index < copied) continue
    const headEnd = head.index + head[0].length
    const end = head[0].endsWith('{') ? clauseEnds[firstAtOrAfter(closes, headEnd)] : headEnd
    if (end === undefined) continue
    result += content.slice(copied, head.index)
    copied = end
  }
  return result + content.slice(copied)
}
