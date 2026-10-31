/**
 * One place that builds an authenticated Octokit client.
 *
 * Each caller passes its own token and the numbers it has always used: there is no default timeout
 * and no default logger, so a caller that passed neither keeps passing neither. What a missing token
 * means is also the caller's (its own error class and message), handed in as `missingToken`.
 *
 * `@octokit/rest` is loaded with a dynamic import inside this module. Vitest mocks a module by its
 * resolved id, so a test that mocks `@octokit/rest` reaches the client built here no matter how the
 * caller used to import it. `loadConstructor` is the seam for a test that would rather not touch the
 * module registry.
 */

import type {Octokit} from '@octokit/rest'

/** The four log methods Octokit calls. Passing no-ops keeps request URLs out of stderr. */
export interface OctokitLog {
  readonly debug: (message: string, additionalInfo?: object) => unknown
  readonly info: (message: string, additionalInfo?: object) => unknown
  readonly warn: (message: string, additionalInfo?: object) => unknown
  readonly error: (message: string, additionalInfo?: object) => unknown
}

/**
 * A logger whose four methods do nothing. A function and not a constant: Stryker covers a mutant in a
 * module-level constant with no test, so it would survive.
 */
export function noopLog() {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  }
}

/** What the constructor receives: the token, plus a timeout and a logger only when the caller asked. */
export interface OctokitConstructorOptions {
  readonly auth: string
  readonly request?: {readonly timeout: number}
  readonly log?: OctokitLog
}

export type OctokitConstructor<TClient> = new (options: OctokitConstructorOptions) => TClient

/** Why the `@octokit/rest` constructor could not be used. */
export type OctokitLoadFailure = 'missing-export' | 'not-a-constructor'

/** The `@octokit/rest` module has no usable `Octokit` constructor. A `TypeError`, as every site threw. */
export class OctokitLoadError extends TypeError {
  readonly reason: OctokitLoadFailure

  constructor(reason: OctokitLoadFailure) {
    super('Failed to load @octokit/rest Octokit constructor')
    this.name = 'OctokitLoadError'
    this.reason = reason
  }
}

/** The default constructor seam: the `Octokit` export of `@octokit/rest`. */
export async function loadOctokitConstructor<TClient = Octokit>(): Promise<OctokitConstructor<TClient>> {
  const loaded: object = await import('@octokit/rest')
  if (!('Octokit' in loaded)) throw new OctokitLoadError('missing-export')
  const constructor: unknown = loaded.Octokit
  if (typeof constructor !== 'function') throw new OctokitLoadError('not-a-constructor')
  // The check above makes it a constructor; the caller names the client shape it uses.
  return constructor as OctokitConstructor<TClient>
}

export interface CreateOctokitOptions<TClient> {
  /** Request timeout in milliseconds. Omitted means the constructor gets no `request` option. */
  readonly timeoutMs?: number
  /** Omitted means the constructor gets no `log` option, so Octokit logs as it always has. */
  readonly log?: OctokitLog
  /** Defaults to `loadOctokitConstructor`. */
  readonly loadConstructor?: () => Promise<OctokitConstructor<TClient>>
}

export interface CreateOctokitCheckedOptions<TClient> extends CreateOctokitOptions<TClient> {
  /** The error to throw when the token is undefined or empty. Thrown before the constructor is loaded. */
  readonly missingToken: () => Error
}

/** A token the caller already holds. It is used as given, an empty string included. */
export async function createOctokit<TClient = Octokit>(
  token: string,
  options?: CreateOctokitOptions<TClient>,
): Promise<TClient>
/** A token read from the environment: undefined or empty throws the caller's own error. */
export async function createOctokit<TClient = Octokit>(
  token: string | undefined,
  options: CreateOctokitCheckedOptions<TClient>,
): Promise<TClient>
export async function createOctokit<TClient = Octokit>(
  token: string | undefined,
  options: CreateOctokitOptions<TClient> & {readonly missingToken?: () => Error} = {},
): Promise<TClient> {
  if (options.missingToken !== undefined && (token === undefined || token === '')) throw options.missingToken()

  const Constructor = await (options.loadConstructor ?? loadOctokitConstructor<TClient>)()
  const request = options.timeoutMs === undefined ? {} : {request: {timeout: options.timeoutMs}}
  const log = options.log === undefined ? {} : {log: options.log}
  // The overloads leave `undefined` possible here only when `missingToken` is given, and it threw.
  return new Constructor({auth: token as string, ...request, ...log})
}
