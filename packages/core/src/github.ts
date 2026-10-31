/**
 * One place that builds an authenticated Octokit client.
 *
 * The token is the caller's, and so are the numbers: there is no default timeout and no default
 * logger, so the constructor receives `request` and `log` only when a caller passes them. What a
 * missing token means is the caller's too (its own error class and message), handed in as
 * `missingToken`.
 *
 * `@octokit/rest` is loaded with a dynamic import inside this module, so a test's
 * `vi.mock('@octokit/rest')` reaches every client built here. The default path returns the real
 * `Octokit` type and names no client type: a caller takes the client into its own interface by
 * assignment or return type, and the compiler checks `Octokit` against it. A client type is inferred
 * only when a matching `loadConstructor` is supplied, the seam for a test that would rather not
 * touch the module registry.
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
export async function loadOctokitConstructor(): Promise<OctokitConstructor<Octokit>> {
  const loaded: object = await import('@octokit/rest')
  if (!('Octokit' in loaded)) throw new OctokitLoadError('missing-export')
  const constructor: unknown = loaded.Octokit
  if (typeof constructor !== 'function') throw new OctokitLoadError('not-a-constructor')
  // The checks above make it a constructor; `@octokit/rest` types its `Octokit` export as this one.
  return constructor as OctokitConstructor<Octokit>
}

interface ClientOptions {
  /** Request timeout in milliseconds. Omitted means the constructor gets no `request` option. */
  readonly timeoutMs?: number
  /** Omitted means the constructor gets no `log` option, so Octokit logs as it always has. */
  readonly log?: OctokitLog
}

/** Builds the real `@octokit/rest` client. */
export interface DefaultClientOptions extends ClientOptions {
  readonly loadConstructor?: undefined
}

/** Builds whatever client the supplied constructor makes, and returns that type. */
export interface CustomClientOptions<TClient> extends ClientOptions {
  readonly loadConstructor: () => Promise<OctokitConstructor<TClient>>
}

/** Marks a token that may be undefined or empty and names the error that means. */
export interface MissingTokenOption {
  /** The error to throw when the token is undefined or empty. Thrown before the constructor is loaded. */
  readonly missingToken: () => Error
}

/** A token the caller already holds. It is used as given, an empty string included. */
export async function createOctokit(token: string, options?: DefaultClientOptions): Promise<Octokit>
/** A token read from the environment: undefined or empty throws the caller's own error. */
export async function createOctokit(
  token: string | undefined,
  options: DefaultClientOptions & MissingTokenOption,
): Promise<Octokit>
export async function createOctokit<TClient>(token: string, options: CustomClientOptions<TClient>): Promise<TClient>
export async function createOctokit<TClient>(
  token: string | undefined,
  options: CustomClientOptions<TClient> & MissingTokenOption,
): Promise<TClient>
export async function createOctokit(
  token: string | undefined,
  options: (DefaultClientOptions | CustomClientOptions<unknown>) & Partial<MissingTokenOption> = {},
): Promise<unknown> {
  if (options.missingToken !== undefined && (token === undefined || token === '')) throw options.missingToken()

  const Constructor = await (options.loadConstructor ?? loadOctokitConstructor)()
  const request = options.timeoutMs === undefined ? {} : {request: {timeout: options.timeoutMs}}
  const log = options.log === undefined ? {} : {log: options.log}
  // The overloads leave `undefined` possible here only when `missingToken` is given, and it threw.
  return new Constructor({auth: token as string, ...request, ...log})
}
