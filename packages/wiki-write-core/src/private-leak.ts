export type GuardResult = {readonly ok: true} | {readonly ok: false; readonly matchedFiles: readonly string[]}

export interface PrivateLeakAdapter {
  resolvePrivateRepositoryNames: (params: {
    readonly content: string
    readonly snapshotSha?: string
  }) => Promise<readonly string[]>
}

export interface PrivateLeakScanRequest {
  readonly privateNames: readonly string[]
  readonly diff: string
  readonly override: OverrideOptions
}

export interface OverrideOptions {
  readonly titlePrefixed: boolean
  readonly isOperator: boolean
}

/**
 * Pure private-repository disclosure detector. The request-time GitHub adapter
 * belongs outside this module and supplies only the authority list.
 */
export function checkPrivateLeak(
  privateNames: readonly string[],
  diff: string,
  override: OverrideOptions,
): GuardResult {
  if (override.titlePrefixed && override.isOperator) {
    return {ok: true}
  }

  // No early return for privateNames.length === 0 or diff.length === 0: both converge to
  // {ok: true} through the main path anyway (empty lowerNames means .some never matches;
  // ''.split('\n') yields one non-matching line), so the guard was a pure optimization, not a
  // behavior difference. Pinned by tests below rather than special-cased here.
  const lowerNames = privateNames.map(name => name.toLowerCase())
  const matchedFiles: string[] = []
  let currentFile: string | null = null
  // A '+++' line is a header only when the immediately preceding line was a '--- ' header
  // (#3838); otherwise it is added content starting with '++' and must be scanned. `undefined`
  // = no header expected; boolean = header expected, true when that '--- ' was '/dev/null'.
  // Set only in the '--- ' branch, read once at the top of the next iteration, then cleared.
  let pendingNewFileCheck: boolean | undefined
  // '---'/'+++' are headers only before a file section's first '@@' hunk marker; inside a hunk
  // they are content (a modified line renders as '--- ...' / '+++ ...'). '@@' at index 0 is
  // unambiguous: hunk lines render '-@@', '+@@', or ' @@'. Reset per 'diff --git a/' section.
  // No initializer: currentFile is null until the first 'diff --git a/' line, which also sets
  // this, so the starting value is unreadable -- a `= false` literal would be an equivalent
  // mutant.
  let inHunk: boolean | undefined

  const checkPath = (path: string): void => {
    const pathLower = path.toLowerCase()
    if (lowerNames.some(name => pathLower.includes(name)) && !matchedFiles.includes(path)) {
      matchedFiles.push(path)
    }
  }

  // Shared by the '+' added-line scan below and the hunk-header trailing-context scan (#3842):
  // both attribute a match to the file the hunk belongs to, not to a path of their own.
  const checkContent = (text: string): void => {
    const contentLower = text.toLowerCase()
    if (
      currentFile !== null &&
      lowerNames.some(name => contentLower.includes(name)) &&
      !matchedFiles.includes(currentFile)
    ) {
      matchedFiles.push(currentFile)
    }
  }

  for (const line of diff.split('\n')) {
    const expectingPlusHeader = pendingNewFileCheck
    pendingNewFileCheck = undefined

    if (line.startsWith('diff --git a/')) {
      const diffPrefix = 'diff --git a/'
      const separator = ' b/'
      // Index scanning, not a regex: the original `/^diff --git a\/.+ b\/(.+)$/` backtracked on
      // caller-supplied diff text. Keep this branch regex-free -- no timing guard covers it (#3810).
      // The old regex selected the rightmost separator with at least one trailing character.
      // No upper-bound check is needed here: lastIndexOf's own `fromIndex` argument
      // (line.length - separator.length - 1) already guarantees any found index satisfies
      // foundIndex + separator.length < line.length, so a found separatorIndex always leaves
      // room after it -- the miss case (-1) is rejected below by the diffPrefix.length floor.
      const separatorIndex = line.lastIndexOf(separator, line.length - separator.length - 1)
      if (separatorIndex > diffPrefix.length) {
        const bPath = line.slice(separatorIndex + separator.length)
        const aPath = line.slice(diffPrefix.length, separatorIndex)
        currentFile = bPath
        if (aPath !== bPath) {
          checkPath(bPath)
        }
      } else {
        currentFile = null
      }
      inHunk = false
      continue
    }

    if (line.startsWith('@@')) {
      inHunk = true
      // Grammar (#3842): a hunk header is `@@ -l,s +l,s @@` -- or, for an n-way combined diff,
      // `@@@ -l,s -l,s +l,s @@@` with one more leading/trailing '@' per extra parent -- where
      // both markers use the SAME run length of '@', and the range text between them (digits,
      // commas, spaces, one leading '+'/'-') can never itself contain '@'. Scanning for that
      // same-length run past the leading marker always lands on the real closing marker, never
      // a lookalike inside the ranges -- handling both shapes with no dedicated combined-diff
      // branch (pinned below).
      //
      // Anything after the closing marker is git's optional function-context, drawn from a line
      // above the hunk on the pre-change side, so a match here requires the name to already
      // exist on the base side -- a redaction gap on already-present text, not new disclosure
      // (the '+' scan below still covers new additions). This repo has no markdown diff driver
      // configured (`git check-attr diff` reports "unspecified"), so git falls back to its
      // default funcname pattern (lines starting with a letter, '_' or '$' -- not a digit, not '#') --
      // real context here is ordinary prose, not a heading. Git also truncates funcname context
      // to 80 bytes, so a name past that cut, or split across it, will not substring-match.
      //
      // Fixed here, in the parser, not by suppressing context at the `git diff` call site:
      // checkPrivateLeak takes diffs from more than one producer (a direct git-diff subprocess
      // and the GitHub compare API's raw diff), and a producer-side fix would leave every other
      // source unguarded.
      //
      // No `continue`: nothing between here and the `!line.startsWith('+')` filter below can
      // match a line beginning with '@', so falling through is safe. A branch inserted above
      // that filter later must preserve that property or add its own '@'-guard.
      let markerLength = 0
      while (line[markerLength] === '@') markerLength += 1
      const marker = '@'.repeat(markerLength)
      const closingIndex = line.indexOf(marker, markerLength)
      const context = closingIndex === -1 ? line.slice(markerLength) : line.slice(closingIndex + marker.length)
      if (context !== '') {
        checkContent(context)
      }
    }

    if (line.startsWith('rename to ') || line.startsWith('copy to ')) {
      const destination = line.startsWith('rename to ')
        ? line.slice('rename to '.length)
        : line.slice('copy to '.length)
      if (destination !== '') {
        checkPath(destination)
      }
      continue
    }

    if (!inHunk && line.startsWith('--- ')) {
      pendingNewFileCheck = line === '--- /dev/null'
      continue
    }

    if (!inHunk && line.startsWith('+++') && expectingPlusHeader !== undefined) {
      if (expectingPlusHeader && currentFile !== null) {
        checkPath(currentFile)
      }
      continue
    }

    if (!line.startsWith('+')) {
      continue
    }

    checkContent(line.slice(1))
  }

  return matchedFiles.length === 0 ? {ok: true} : {ok: false, matchedFiles}
}

export async function checkPrivateLeakWithAdapter(
  adapter: PrivateLeakAdapter,
  request: Omit<PrivateLeakScanRequest, 'privateNames'> & {readonly content: string; readonly snapshotSha?: string},
): Promise<GuardResult> {
  const privateNames = await adapter.resolvePrivateRepositoryNames({
    content: request.content,
    snapshotSha: request.snapshotSha,
  })
  return checkPrivateLeak(privateNames, request.diff, request.override)
}
