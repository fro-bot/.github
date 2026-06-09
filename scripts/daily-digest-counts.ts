import {readFileSync} from 'node:fs'
import process from 'node:process'

import {parse as parseYaml} from 'yaml'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RepoEntry {
  private?: boolean
  last_survey_at?: string | null
}

interface ReposYaml {
  repos?: RepoEntry[]
}

export interface DigestCounts {
  repos_tracked: number
  surveys_today: number
  should_post: boolean
  count_status: 'ok' | 'error'
}

// ─── Core derivation (exported for tests) ────────────────────────────────────

/**
 * Derive digest counts from a repos.yaml file's raw YAML content string.
 *
 * @param yamlContent - Raw YAML string (the contents of metadata/repos.yaml).
 * @param todayUtc    - Today's date in YYYY-MM-DD format (UTC). Injected for
 *                      testability so tests can pin the UTC boundary.
 * @returns DigestCounts — never throws; emits a stderr diagnostic on error.
 *
 * Note: `surveys_today` reflects the **prior UTC day's** settled survey count
 * (yesterdayUtc = todayUtc − 1 day). The digest runs at 00:00 UTC, so the
 * prior day is fully settled (~16h after its reconcile). Counting same-day
 * surveys would always yield ~0 at that hour. The gateway field name
 * `surveys_today` is retained for payload schema compatibility.
 *
 * `should_post` is `count_status === 'ok'` — the digest fires every scheduled
 * day regardless of survey count; zero surveys is valid signal. It is only
 * `false` on a genuine metadata read error.
 */
export function deriveCounts(yamlContent: string, todayUtc: string): DigestCounts {
  const errorResult: DigestCounts = {
    repos_tracked: 0,
    surveys_today: 0,
    should_post: false,
    count_status: 'error',
  }

  if (yamlContent === null || yamlContent === undefined) {
    process.stderr.write('daily-digest-counts: metadata content is null/undefined\n')
    return errorResult
  }

  let parsed: unknown
  try {
    parsed = parseYaml(yamlContent)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    process.stderr.write(`daily-digest-counts: failed to parse YAML: ${detail}\n`)
    return errorResult
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    process.stderr.write('daily-digest-counts: YAML root is not an object\n')
    return errorResult
  }

  const data = parsed as ReposYaml

  if (!Array.isArray(data.repos)) {
    process.stderr.write('daily-digest-counts: metadata/repos.yaml missing `repos` array\n')
    return errorResult
  }

  // Derive yesterdayUtc: parse todayUtc as UTC midnight, subtract 86400000ms, reformat.
  // This is UTC-safe: YYYY-MM-DD parsed as UTC avoids local-timezone drift.
  const todayMs = Date.parse(`${todayUtc}T00:00:00Z`)
  const yesterdayUtc = new Date(todayMs - 86_400_000).toISOString().slice(0, 10)

  let reposTracked = 0
  let surveysYesterday = 0

  for (const entry of data.repos) {
    // Guard: a null or non-object element is a malformed entry — treat as data error.
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      process.stderr.write('daily-digest-counts: malformed repos[] element (null, non-object, or array)\n')
      return errorResult
    }

    // Only entries with explicit `private: false` count as public.
    // Entries missing `private` or with `private: true` are NOT counted.
    if (entry.private === false) {
      reposTracked++

      // Count public entries whose last_survey_at (YYYY-MM-DD) equals the prior UTC day.
      // Private repos are excluded — the gateway's public-only intent applies here too.
      if (typeof entry.last_survey_at === 'string' && entry.last_survey_at === yesterdayUtc) {
        surveysYesterday++
      }
    }
  }

  return {
    repos_tracked: reposTracked,
    surveys_today: surveysYesterday,
    should_post: true, // count_status === 'ok': post every day; suppress only on read error
    count_status: 'ok',
  }
}

// ─── CLI entrypoint ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Accept file path as first arg, defaulting to 'metadata/repos.yaml'.
  const filePath = process.argv[2] ?? 'metadata/repos.yaml'

  // Accept today's UTC date as second arg or TODAY_UTC env var (for testing/CI override).
  // Default: derive from the current UTC clock.
  const todayUtc = process.argv[3] ?? process.env.TODAY_UTC ?? new Date().toISOString().slice(0, 10) // YYYY-MM-DD

  let yamlContent: string
  try {
    yamlContent = readFileSync(filePath, 'utf8')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    process.stderr.write(`daily-digest-counts: failed to read ${filePath}: ${detail}\n`)
    const errorResult: DigestCounts = {
      repos_tracked: 0,
      surveys_today: 0,
      should_post: false,
      count_status: 'error',
    }
    process.stdout.write(`${JSON.stringify(errorResult)}\n`)
    process.exit(0)
  }

  let result: DigestCounts
  try {
    result = deriveCounts(yamlContent, todayUtc)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    process.stderr.write(`daily-digest-counts: unexpected error in deriveCounts: ${detail}\n`)
    const errorResult: DigestCounts = {
      repos_tracked: 0,
      surveys_today: 0,
      should_post: false,
      count_status: 'error',
    }
    process.stdout.write(`${JSON.stringify(errorResult)}\n`)
    process.exit(0)
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exit(0)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
