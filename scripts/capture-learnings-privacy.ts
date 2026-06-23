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
import {parse} from 'yaml'

import {buildPrivateTokenSet} from './wiki-slug.ts'

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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
 * - Credential-bearing connection strings: scheme://user:pass@host (postgres, mysql, redis, mongodb, amqp)
 * - AWS access keys: AKIA/ASIA prefix + 16 uppercase alphanumeric chars
 * - OpenAI/Anthropic keys: sk- or sk-ant- prefix + 20+ chars
 * - Slack tokens: xox[bpars]- prefix + 10+ chars
 */
const SECRET_BLOCK_PATTERNS: RegExp[] = [
  // GitHub PATs (classic): ghp_, gho_, ghu_, ghs_, ghr_
  /gh[pousr]_[A-Za-z0-9]{36,255}/,
  // Fine-grained PAT
  /github_pat_\w{82}/,
  // Private key blocks (RSA, EC, PKCS#8, etc.)
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  // Credential-bearing connection strings (user:pass@host required)
  /(?:postgres|postgresql|mysql|redis|mongodb|amqps?):\/\/[^\s:]+:[^\s@]+@[^\s/]+/,
  // AWS access keys
  /(?:AKIA|ASIA)[0-9A-Z]{16}/,
  // OpenAI keys (sk-) and Anthropic keys (sk-ant-) — two separate patterns to avoid redundancy
  /sk-ant-\w{20,}/,
  /sk-[A-Za-z0-9\-]{20,}/,
  // Slack tokens
  /xox[bpars]-[\w-]{10,}/,
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
 * - Internal hostnames: *.fro.bot, *.bfra.me
 *
 * Minimum length guards (8 chars for Bearer/Authorization) prevent over-redacting
 * short placeholder values like 'token=x'.
 */
const SECRET_REDACT_PATTERNS: [RegExp, string][] = [
  // Bearer tokens (min 8 chars to avoid over-redacting short placeholders)
  [/Bearer\s+[\w\-.=]{8,}/g, 'Bearer [REDACTED]'],
  // Authorization header values: capture scheme + credential (e.g. 'Basic dXNlcjpwYXNz', 'Bearer token')
  // Matches two whitespace-delimited tokens after the colon, or one token of 8+ chars.
  [/Authorization:\s*(?:\S+\s+\S{4,}|\S{8,})/g, 'Authorization: [REDACTED]'],
  // File paths: /home/<user>, /Users/<user>, C:\Users\<user>, ~/.dotfile, /var/log/..., /etc/<name>
  [
    /(?:\/home\/[\w.-]+|\/Users\/[\w.-]+|C:\\Users\\[\w.-]+|~\/\.[a-z]+|\/var\/log\/[\w./-]*|\/etc\/[a-z]+)/g,
    '[REDACTED]',
  ],
  // Internal hostnames: *.fro.bot
  [/[a-z0-9-]+\.fro\.bot\b/g, '[REDACTED]'],
  // Internal hostnames: *.bfra.me
  [/[a-z0-9-]+\.bfra\.me\b/g, '[REDACTED]'],
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
  return result
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
