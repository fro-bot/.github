/**
 * Shared fail-closed privacy gate for the learning-capture pipeline.
 *
 * Provides the pure privacy-scan function and the fail-closed disk loader for the
 * private identifier token set. Both the open step (authored-body scan) and the
 * harvest step (upstream enrichment scan) import from here — single source of truth.
 *
 * Fail-closed contract:
 * - If `loadPrivateTokensFromDisk` throws, the caller MUST NOT post or emit any
 *   unscanned content (no private set loaded ⇒ no proposals / no enriched content).
 * - The privacy gate blocks on a hit; it never redacts. Counts-only telemetry.
 * - Private names are never logged; only counts appear in output.
 *
 * Strip-only safe: no parameter properties, enums, or namespaces.
 */

import {readFile} from 'node:fs/promises'
import process from 'node:process'
import {isRecord} from '@fro-bot/core/guards'
import {buildPrivateTokenSet} from '@fro.bot/wiki-write-core/wiki-slug'
import {parse} from 'yaml'

// ---------------------------------------------------------------------------
// Secret detection — block patterns (pure, no I/O)
// ---------------------------------------------------------------------------

/**
 * Hard-secret patterns that BLOCK content from reaching the agent.
 * These shapes must never be redacted — they must cause the content to be dropped entirely.
 *
 * Pattern set (v1):
 * - GitHub PATs: gh[pousr]_ prefix + 36–255 alphanumeric chars
 * - Fine-grained PAT: github_pat_ prefix + exactly 82 alphanumeric/underscore chars
 * - Private key blocks: -----BEGIN [TYPE] PRIVATE KEY----- header
 * - Credential-bearing connection strings: scheme://user:pass@host (postgres, mysql, redis, mongodb, amqp);
 *   scanned by `hasCredentialedConnectionString`
 * - AWS access keys: AKIA/ASIA prefix + 16 uppercase alphanumeric chars
 * - OpenAI/Anthropic keys: sk- or sk-ant- prefix + 20+ chars
 * - Slack tokens: xox[bpars]- prefix + 10+ chars
 * - JWTs: header.payload.signature, scanned by `hasJwt`
 *
 * The connection-string and JWT shapes are scanners, not regexes. Their regex forms backtrack
 * quadratically on bodies with many scheme or `eyJ` openings (a regex per opening rescans the rest of its
 * run), and these bodies are untrusted text of any size. Every pattern left in the list either has a
 * bounded repetition or a repetition with nothing after it, so a failed attempt costs a bounded
 * number of steps or consumes its own run.
 */
const SECRET_BLOCK_PATTERNS: RegExp[] = [
  // GitHub PATs (classic): ghp_, gho_, ghu_, ghs_, ghr_
  /gh[pousr]_[A-Za-z0-9]{36,255}/,
  // Fine-grained PAT
  /github_pat_\w{82}/,
  // Private key blocks (RSA, EC, PKCS#8, etc.)
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  // AWS access keys
  /(?:AKIA|ASIA)[0-9A-Z]{16}/,
  // OpenAI keys (sk-) and Anthropic keys (sk-ant-) — two separate patterns to avoid redundancy
  /sk-ant-\w{20,}/,
  /sk-[A-Za-z0-9\-]{20,}/,
  // Slack tokens
  /xox[bpars]-[\w-]{10,}/,
  // Google API keys
  /AIza[\w\-]{35}/,
  // GitLab PATs
  /glpat-[\w\-]{20,}/,
  // Generic credential assignment catch-all (password=, secret=, api_key=, etc.)
  /(?:password|passwd|secret|api[._-]?key|auth[._-]?token|access[._-]?token)["']?\s*[=:]\s*["']?[^\s"']{16,}/i,
]

/**
 * Returns true when the body contains a hard-secret shape that must BLOCK the content.
 *
 * Iterates the block pattern set and returns true on the first match.
 * Never redacts — block only. The caller MUST drop the content on true.
 *
 * Pure function: no I/O, fully testable.
 */
export function logDiffHasSecret(body: string): boolean {
  for (const pattern of SECRET_BLOCK_PATTERNS) {
    if (pattern.test(body)) return true
  }
  return hasCredentialedConnectionString(body) || hasJwt(body)
}

function isWhitespace(char: string): boolean {
  return /\s/.test(char)
}

function isTokenChar(char: string): boolean {
  return /[\w-]/.test(char)
}

/**
 * A lookup for the first index at or after `from` whose character satisfies `isStop`, or the length of
 * `body` when none does. Queries come with non-decreasing `from`, so a stop found for one query answers
 * every later query that starts at or before it, and a whole sequence of queries scans each character at
 * most once.
 */
function createStopFinder(body: string, isStop: (char: string) => boolean): (from: number) => number {
  let scannedFrom = 0
  let stop = -1
  return from => {
    if (from >= scannedFrom && from <= stop) return stop
    let index = from
    while (index < body.length && !isStop(body.charAt(index))) index += 1
    scannedFrom = from
    stop = index
    return index
  }
}

/**
 * True when `body` holds `scheme://user:password@host` for postgres, postgresql, mysql, redis, mongodb,
 * amqp or amqps: `user` is a non-empty run without whitespace or `:`, `password` a non-empty run without
 * whitespace or `@`, and `host` starts with a character that is neither whitespace nor `/`. Equivalent to
 * `/(?:postgres|postgresql|mysql|redis|mongodb|amqps?):\/\/[^\s:]+:[^\s@]+@[^\s/]+/` in linear time: `user`
 * ends at the first `:` or whitespace and `password` at the first `@` or whitespace, so each is found once.
 */
export function hasCredentialedConnectionString(body: string): boolean {
  const scheme = /(?:postgres|postgresql|mysql|redis|mongodb|amqps?):\/\//g
  const nextColonOrSpace = createStopFinder(body, char => char === ':' || isWhitespace(char))
  const nextAtOrSpace = createStopFinder(body, char => char === '@' || isWhitespace(char))

  for (let match = scheme.exec(body); match !== null; match = scheme.exec(body)) {
    const userStart = match.index + match[0].length
    const colon = nextColonOrSpace(userStart)
    if (colon === userStart || body.charAt(colon) !== ':') continue

    const passwordStart = colon + 1
    const at = nextAtOrSpace(passwordStart)
    if (at === passwordStart || body.charAt(at) !== '@') continue

    const host = body.charAt(at + 1)
    if (host !== '' && host !== '/' && !isWhitespace(host)) return true
  }
  return false
}

/**
 * True when `body` holds a JWT shape, `eyJ<token>.eyJ<token>.<token>` with every `<token>` a non-empty
 * run of word characters and `-`. Equivalent to `/eyJ[\w\-]+\.eyJ[\w\-]+\.[\w\-]+/` in linear time: each of
 * the first two runs is maximal because the next character must be `.`, so its end is found once.
 */
export function hasJwt(body: string): boolean {
  const firstRunEnd = createStopFinder(body, char => !isTokenChar(char))
  const secondRunEnd = createStopFinder(body, char => !isTokenChar(char))

  for (let start = body.indexOf('eyJ'); start !== -1; start = body.indexOf('eyJ', start + 1)) {
    const firstEnd = firstRunEnd(start + 3)
    if (firstEnd === start + 3 || !body.startsWith('.eyJ', firstEnd)) continue

    const secondStart = firstEnd + 4
    const secondEnd = secondRunEnd(secondStart)
    if (secondEnd === secondStart || body.charAt(secondEnd) !== '.') continue

    if (isTokenChar(body.charAt(secondEnd + 1))) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Secret redaction — redact patterns (pure, no I/O)
// ---------------------------------------------------------------------------

/**
 * Redact-class patterns: structural values that should be replaced with '[REDACTED]'
 * while preserving the surrounding prose. Applied in sequence.
 *
 * Each entry is [pattern, replacement]:
 * - Bearer tokens: 'Bearer <value>' → 'Bearer [REDACTED]'
 * - Authorization headers: 'Authorization: <value>' → 'Authorization: [REDACTED]'
 * - File paths: /home/..., /Users/..., C:\Users\..., ~/.dotfile, /var/log/..., /etc/...
 *
 * Internal hostnames (*.fro.bot, *.bfra.me) are redacted after these, by `redactInternalHostnames`.
 *
 * Minimum length guards (8 chars for Bearer/Authorization) prevent over-redacting
 * short placeholder values like 'token=x'.
 */
const SECRET_REDACT_PATTERNS: [RegExp, string][] = [
  // Bearer tokens (min 8 chars to avoid over-redacting short placeholders)
  // Includes +/ for base64-encoded values
  [/Bearer\s+[\w\-.=+/]{8,}/g, 'Bearer [REDACTED]'],
  // Authorization header values: capture scheme + credential (e.g. 'Basic dXNlcjpwYXNz', 'Bearer token')
  // Matches two whitespace-delimited tokens after the colon, or one token of 8+ chars.
  [/Authorization:\s*(?:\S+\s+\S{4,}|\S{8,})/g, 'Authorization: [REDACTED]'],
  // File paths: /home/<user>, /Users/<user>, C:\Users\<user>, ~/.dotfile, /var/log/..., /etc/<name>
  [
    /(?:\/home\/[\w.-]+|\/Users\/[\w.-]+|C:\\Users\\[\w.-]+|~\/\.[a-z]+|\/var\/log\/[\w./-]*|\/etc\/[a-z]+)/g,
    '[REDACTED]',
  ],
]

/**
 * Returns the body with REDACT-class patterns replaced by '[REDACTED]'.
 *
 * Structure is preserved — prose around the redacted values remains intact.
 * Applies each redact pattern in sequence. Does NOT block — use `logDiffHasSecret`
 * first to check for hard-secret shapes that must block entirely.
 *
 * Pure function: no I/O, fully testable.
 */
export function redactLogDiffSecrets(body: string): string {
  let result = body
  for (const [pattern, replacement] of SECRET_REDACT_PATTERNS) {
    result = result.replaceAll(pattern, replacement)
  }
  result = redactInternalHostnames(result, '.fro.bot')
  return redactInternalHostnames(result, '.bfra.me')
}

function isWordChar(char: string): boolean {
  return /\w/.test(char)
}

function isHostnameChar(char: string): boolean {
  return /[a-z0-9-]/.test(char)
}

/**
 * Replaces each `<label><suffix>` hostname with '[REDACTED]', where `<label>` is a non-empty run of
 * `[a-z0-9-]` and the suffix ends at a word boundary. Equivalent to
 * `body.replaceAll(/[a-z0-9-]+\.fro\.bot\b/g, '[REDACTED]')` (and the `.bfra.me` form) in linear time. The
 * regex tries every start in a long run of label characters and rescans the run from each; here each
 * suffix is located once and its label is read leftwards, never past the end of the previous
 * replacement, so the leftward reads of different suffixes do not overlap.
 */
export function redactInternalHostnames(body: string, suffix: string): string {
  let redacted = ''
  let copiedTo = 0
  let at = body.indexOf(suffix)

  while (at !== -1) {
    const end = at + suffix.length
    let start = at
    if (!isWordChar(body.charAt(end))) {
      while (start > copiedTo && isHostnameChar(body.charAt(start - 1))) start -= 1
    }
    if (start < at) {
      redacted += `${body.slice(copiedTo, start)}[REDACTED]`
      copiedTo = end
      at = body.indexOf(suffix, end)
    } else {
      at = body.indexOf(suffix, at + 1)
    }
  }
  return redacted + body.slice(copiedTo)
}

// ---------------------------------------------------------------------------
// Privacy gate — pure, fail-closed
// ---------------------------------------------------------------------------

/**
 * Returns true if the body contains any private identifier token.
 *
 * The body is lowercased before scanning. The caller MUST block (skip) the
 * content on true. Never redacts — block only. Counts-only telemetry.
 *
 * Pure function: no I/O, fully testable.
 */
export function learningBodyHasPrivateLeak(body: string, privateTokens: Set<string>): boolean {
  const lower = body.toLowerCase()
  for (const token of privateTokens) {
    if (lower.includes(token)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Disk loader for private token set
// ---------------------------------------------------------------------------

/**
 * Load the private identifier token set from `metadata/repos.yaml`.
 *
 * Reads the overlay-checked-out metadata file, filters `private: true` non-redacted
 * entries, and builds the token set via `buildPrivateTokenSet`.
 *
 * Fail-closed contract:
 * - If the file cannot be read or parsed, this function THROWS.
 * - The caller MUST NOT post any proposals or emit enriched content when this throws
 *   (no private set ⇒ no unscanned content passes through).
 * - This is intentional: a missing overlay means the privacy gate cannot operate,
 *   and passing unscanned content would violate the privacy-gate contract.
 *
 * Counts-only: private names are never logged; only counts appear in stderr.
 *
 * @param readFileFn - Injectable readFile for testing (defaults to node:fs/promises readFile).
 */
export async function loadPrivateTokensFromDisk(
  readFileFn: (path: string, encoding: BufferEncoding) => Promise<string> = readFile,
): Promise<Set<string>> {
  let reposYaml: string

  try {
    reposYaml = await readFileFn('metadata/repos.yaml', 'utf8')
  } catch (error: unknown) {
    throw new Error(
      'capture-learnings-privacy: could not read metadata/repos.yaml — privacy gate cannot operate; no learnings will be posted',
      {cause: error},
    )
  }

  let parsed: unknown
  try {
    parsed = parse(reposYaml)
  } catch (error: unknown) {
    throw new Error(
      'capture-learnings-privacy: could not parse metadata/repos.yaml — privacy gate cannot operate; no learnings will be posted',
      {cause: error},
    )
  }

  if (!isRecord(parsed)) {
    throw new TypeError(
      'capture-learnings-privacy: metadata/repos.yaml has unexpected shape — privacy gate cannot operate; no learnings will be posted',
    )
  }

  const repos = parsed.repos
  if (!Array.isArray(repos)) {
    throw new TypeError(
      'capture-learnings-privacy: metadata/repos.yaml missing repos array — privacy gate cannot operate; no learnings will be posted',
    )
  }

  const privateNames: string[] = []
  for (const entry of repos) {
    if (!isRecord(entry)) continue
    if (entry.private !== true) continue
    const owner = entry.owner
    const name = entry.name
    if (typeof owner !== 'string' || typeof name !== 'string' || owner === '[REDACTED]' || name === '[REDACTED]') {
      continue
    }
    privateNames.push(`${owner}/${name}`)
  }

  const tokenSet = buildPrivateTokenSet(privateNames)
  process.stderr.write(
    `capture-learnings-privacy: loaded private token set (private-repo count=${privateNames.length}, token-count=${tokenSet.size})\n`,
  )
  return tokenSet
}
