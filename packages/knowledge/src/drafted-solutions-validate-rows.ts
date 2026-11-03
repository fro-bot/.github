/**
 * Local row validator for the drafting agent: run it before finishing to catch rows the publish
 * job would reject. Pure and offline: it reads two files and makes no network call.
 *
 * It runs the exact validation publish uses ({@link checkAgentRows}: exactly one row per digest
 * proposal, none extra, and the coverage schema including `FIELD_LIMITS`), but reports every
 * error, each tagged with its issue number, so the agent can repair all rows in one pass.
 *
 * CLI contract:
 * - optional env `DRAFTED_SOLUTIONS_ROWS_PATH` (default `.drafted-solutions/rows.json`) and
 *   `DRAFTED_SOLUTIONS_DIGEST_PATH` (default `.drafted-solutions/drafted-solutions-digest.json`),
 *   both relative to the working directory.
 * - exit 0 and a one-line summary on stdout when the rows are valid; exit 1 and one error per line
 *   on stderr otherwise (including unreadable or non-JSON input).
 *
 * Strip-only safe: no parameter properties, enums, or namespaces.
 */

import {readFile} from 'node:fs/promises'

import {checkAgentRows, DraftedSolutionsError, parseDigest, type DraftedDigest} from './drafted-solutions-shared.ts'

const DEFAULT_ROWS_PATH = '.drafted-solutions/rows.json'
const DEFAULT_DIGEST_PATH = '.drafted-solutions/drafted-solutions-digest.json'

export interface RowsValidation {
  ok: boolean
  count: number
  errors: string[]
}

/** Validates already-parsed rows against a parsed digest. */
export function validateDraftedRows(rows: unknown, digest: DraftedDigest): RowsValidation {
  const result = checkAgentRows(rows, digest)
  return result.ok
    ? {ok: true, count: result.rows.length, errors: []}
    : {ok: false, count: Array.isArray(rows) ? rows.length : 0, errors: result.errors}
}

async function readJson(filePath: string, label: string): Promise<unknown> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch {
    throw new DraftedSolutionsError(`${label} could not be read at ${filePath}`)
  }
  try {
    return JSON.parse(raw)
  } catch {
    throw new DraftedSolutionsError(`${label} is not valid JSON`)
  }
}

function nonEmpty(value: string | undefined, fallback: string): string {
  return value === undefined || value === '' ? fallback : value
}

/** The environment a run reads: `process.env` in production, the runner's env in the CLI. */
type Env = Readonly<Record<string, string | undefined>>

/** Where a run writes. The agent reads both streams, so the strings are a contract. */
export interface ValidateRowsIo {
  readonly stdout: (text: string) => void
  readonly stderr: (text: string) => void
}

/** Returns the exit code: 0 when the rows are valid, 1 when they are not. An unreadable file throws. */
export async function runDraftedSolutionsValidateRows(env: Env, io: ValidateRowsIo): Promise<number> {
  const rowsPath = nonEmpty(env.DRAFTED_SOLUTIONS_ROWS_PATH, DEFAULT_ROWS_PATH)
  const digestPath = nonEmpty(env.DRAFTED_SOLUTIONS_DIGEST_PATH, DEFAULT_DIGEST_PATH)

  const digest = parseDigest(await readJson(digestPath, 'digest'))
  const rows = await readJson(rowsPath, 'rows file')

  const result = validateDraftedRows(rows, digest)
  if (!result.ok) {
    for (const error of result.errors) io.stderr(`${error}\n`)
    io.stderr(`${result.errors.length} error(s): fix rows.json and run this again.\n`)
    return 1
  }
  io.stdout(`rows valid: ${result.count} row(s), one per digest proposal\n`)
  return 0
}
