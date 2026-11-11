/**
 * The required checks of `main`, read and judged for one commit. The promotion step and the Renovate
 * approver both import this module, so the fail-closed check logic has one copy.
 *
 * - The live required list is read from the branch protection and must name every context declared in
 *   `.github/settings.yml`. A read that fails, or a list that is empty or short, is a result of its own, not
 *   a guess: the caller decides what to say, and nothing here approves.
 * - A check run counts when its name and app match the requirement (any app when none is named), the
 *   newest of several winning; a commit status, which has no app, is matched by context and the newest wins.
 *   When a context has both, both must pass.
 * - Every request goes through the caller's `read` wrapper, which owns the deadline, the abort signal and the
 *   retry of a transient failure. A deadline error from that wrapper is never turned into a result: it
 *   propagates, so a run that timed out is not reported as an unreadable list.
 * - Lists are read a hundred to a page, up to fifty pages. A reader says when it stopped at that cap.
 */

import type {Octokit} from '@octokit/rest'

import {parse} from 'yaml'

/** The slice of Octokit the readers call, so a test builds a fake of exactly these methods. */
export interface RequiredChecksClient {
  readonly rest: {
    readonly repos: Pick<Octokit['rest']['repos'], 'getBranch' | 'listCommitStatusesForRef'>
    readonly checks: Pick<Octokit['rest']['checks'], 'listForRef'>
  }
}

/** One required context and the app it is bound to, or `null` for any app. */
export interface RequiredCheck {
  readonly context: string
  readonly appId: number | null
}

export interface CheckRunView {
  readonly id: number
  readonly name: string
  readonly status: string
  readonly conclusion: string | null
  readonly appId: number | null
}

export interface StatusView {
  readonly context: string
  readonly state: string
}

/**
 * Runs one request: it carries an abort signal sized to the time left, retries a transient failure, and
 * throws a `DeadlineError` when the time is spent. The caller owns the clock.
 */
export type ReadRequest = <T>(operation: (signal: AbortSignal) => Promise<T>) => Promise<T>

/** Thrown by a request wrapper when its deadline has passed; carries nothing, because the caller knows the run. */
export class DeadlineError extends Error {}

/** A request that was in flight when its signal fired: it was sent, so a write may or may not have happened. */
export class CutOffError extends DeadlineError {}

/** What the live required list for `main` came to: a list to judge by, or the reason there is none. */
export type RequiredListResult =
  | {readonly kind: 'ok'; readonly checks: readonly RequiredCheck[]}
  | {readonly kind: 'unreadable'}
  | {readonly kind: 'empty'}
  | {readonly kind: 'short'; readonly missing: readonly string[]}

export interface RequiredChecksRead {
  readonly client: RequiredChecksClient
  readonly owner: string
  readonly repo: string
  readonly read: ReadRequest
}

/** Settings that read as numbers, inside a function so a mutant in them is exercised. */
function pagination() {
  return {pageSize: 100, maxPages: 50}
}

/** A property of whatever was thrown; `Object()` makes a primitive, `null` or `undefined` safe to read. */
function propertyOf(error: unknown, name: string): unknown {
  return Reflect.get(new Object(error), name)
}

/** The status of a thrown GitHub error, if it has one. */
export function statusOf(error: unknown): number | undefined {
  const status = propertyOf(error, 'status')
  return typeof status === 'number' ? status : undefined
}

/** Whether a failure is worth another attempt: a 429, a 5xx, or a network error that carries no status. */
export function isTransient(error: unknown): boolean {
  const status = statusOf(error)
  if (status !== undefined) return status === 429 || status >= 500
  const code = propertyOf(error, 'code')
  return code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'ENOTFOUND'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The contexts declared for `main` in the text of `.github/settings.yml`; empty when there are none. */
export function parseDeclaredContexts(text: string): readonly string[] {
  const document: unknown = parse(text)
  const branches = isRecord(document) ? document.branches : undefined
  if (!Array.isArray(branches)) return []
  const declared: readonly unknown[] = branches
  const main = declared.find(branch => isRecord(branch) && branch.name === 'main')
  const protection = isRecord(main) ? main.protection : undefined
  const checks = isRecord(protection) ? protection.required_status_checks : undefined
  const contexts = isRecord(checks) ? checks.contexts : undefined
  if (!Array.isArray(contexts)) return []
  return contexts.filter((context: unknown): context is string => typeof context === 'string')
}

/** Whether a check run has finished and, if so, whether it passed. */
function runOutcome(run: CheckRunView): {readonly done: boolean; readonly ok: boolean} {
  return {
    done: run.status === 'completed',
    ok: run.conclusion === 'success' || run.conclusion === 'skipped' || run.conclusion === 'neutral',
  }
}

/** Whether a commit status has finished and, if so, whether it passed. */
function statusOutcome(status: StatusView): {readonly done: boolean; readonly ok: boolean} {
  return {
    done: status.state === 'success' || status.state === 'failure' || status.state === 'error',
    ok: status.state === 'success',
  }
}

/**
 * Judges each required check on a commit. A check run counts when its name and app match the
 * requirement (any app when none is named), the newest of several winning; a commit status, which has no
 * app, is matched by context and the newest wins. When a context has both, both must pass: either failing
 * fails the context, either pending keeps it waiting, and an absent one leaves the other to decide alone.
 */
export function evaluateChecks(
  required: readonly RequiredCheck[],
  runs: readonly CheckRunView[],
  statuses: readonly StatusView[],
): {readonly failed: readonly string[]; readonly pending: readonly string[]} {
  const failed: string[] = []
  const pending: string[] = []
  for (const check of required) {
    const matching = runs.filter(
      run => run.name === check.context && (check.appId === null || run.appId === check.appId),
    )
    const newest = matching.toSorted((left, right) => right.id - left.id)[0]
    const status = statuses.find(candidate => candidate.context === check.context)
    const reported = [
      ...(newest === undefined ? [] : [runOutcome(newest)]),
      ...(status === undefined ? [] : [statusOutcome(status)]),
    ]
    // Nothing reported yet counts as not done.
    if (reported.some(outcome => outcome.done && !outcome.ok)) failed.push(check.context)
    else if (reported.length === 0 || reported.some(outcome => !outcome.done)) pending.push(check.context)
  }
  return {failed, pending}
}

/** Whether two required-check lists name the same contexts bound to the same apps. */
export function sameChecks(left: readonly RequiredCheck[], right: readonly RequiredCheck[]): boolean {
  const keys = (checks: readonly RequiredCheck[]): readonly string[] =>
    checks.map(check => `${check.context}\0${String(check.appId)}`).toSorted()
  return JSON.stringify(keys(left)) === JSON.stringify(keys(right))
}

/**
 * Reads the live required list of `main` and holds it against the declared contexts. A failed read is
 * `unreadable` (a deadline error is rethrown instead), a list with no checks is `empty`, and a list that
 * lacks a declared context is `short` and names what is missing.
 */
export async function readRequiredChecks(
  params: RequiredChecksRead & {readonly declared: readonly string[]},
): Promise<RequiredListResult> {
  const {client, owner, repo, read, declared} = params
  let response: Awaited<ReturnType<RequiredChecksClient['rest']['repos']['getBranch']>>
  try {
    response = await read(async signal => client.rest.repos.getBranch({owner, repo, branch: 'main', request: {signal}}))
  } catch (error: unknown) {
    if (error instanceof DeadlineError) throw error
    return {kind: 'unreadable'}
  }
  const checks = response.data.protection?.required_status_checks?.checks ?? []
  if (checks.length === 0) return {kind: 'empty'}
  const live = checks.map(check => ({context: check.context, appId: check.app_id ?? null}))
  const missing = declared.filter(context => !live.some(check => check.context === context))
  if (missing.length > 0) return {kind: 'short', missing}
  return {kind: 'ok', checks: live}
}

/**
 * Reads pages of a hundred until a short one. `capped` is true when the fiftieth page was full: the list
 * may go on past what was read.
 */
async function pages<T>(
  fetchPage: (page: number) => Promise<readonly T[]>,
): Promise<{readonly items: readonly T[]; readonly capped: boolean}> {
  const config = pagination()
  let all = Array.of<T>()
  for (const page of Array.from({length: config.maxPages}, (_, index) => index + 1)) {
    const items = await fetchPage(page)
    all = all.concat(items)
    if (items.length < config.pageSize) return {items: all, capped: false}
  }
  // Every page up to the cap was full, so the list may go on past what was read.
  return {items: all, capped: true}
}

/** The latest check runs on `ref`, all pages. A failed read throws; `capped` says the page cap was reached. */
export async function readCheckRuns(
  params: RequiredChecksRead & {readonly ref: string},
): Promise<{readonly runs: readonly CheckRunView[]; readonly capped: boolean}> {
  const {client, owner, repo, read, ref} = params
  const {items, capped} = await pages(async page => {
    const response = await read(async signal =>
      client.rest.checks.listForRef({
        owner,
        repo,
        ref,
        filter: 'latest',
        per_page: pagination().pageSize,
        page,
        request: {signal},
      }),
    )
    return response.data.check_runs.map(run => ({
      id: run.id,
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      appId: run.app?.id ?? null,
    }))
  })
  return {runs: items, capped}
}

/** The commit statuses on `ref`, newest first, all pages. A failed read throws; `capped` says the cap was reached. */
export async function readCommitStatuses(
  params: RequiredChecksRead & {readonly ref: string},
): Promise<{readonly statuses: readonly StatusView[]; readonly capped: boolean}> {
  const {client, owner, repo, read, ref} = params
  const {items, capped} = await pages(async page => {
    const response = await read(async signal =>
      client.rest.repos.listCommitStatusesForRef({
        owner,
        repo,
        ref,
        per_page: pagination().pageSize,
        page,
        request: {signal},
      }),
    )
    return response.data.map(status => ({context: status.context, state: status.state}))
  })
  return {statuses: items, capped}
}
