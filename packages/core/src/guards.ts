/**
 * Type guards for untrusted values: parsed JSON and YAML, thrown errors, API payloads.
 *
 * The control plane carried a private copy of these in about thirty modules, and the copies
 * disagreed on arrays. The two shapes are separate exports so each caller names the one it means:
 * `isRecord` rejects arrays, `isObject` accepts them.
 */

/** Any non-null object, arrays included. */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** A non-null object that is not an array. Use this for a parsed JSON or YAML mapping. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return isObject(value) && !Array.isArray(value)
}

/**
 * Whether `error` is a non-array object whose `status` is exactly the number `status`. This is the
 * shape of an Octokit `RequestError`. An array, a primitive, a string `"404"` and a missing
 * `status` are all false.
 */
export function isApiStatus(error: unknown, status: number): boolean {
  return isRecord(error) && error.status === status
}

/**
 * Like `isApiStatus`, but any object qualifies, an array with a `status` property included. Only
 * the caller that accepted every object needs this; the rest use `isApiStatus`.
 */
export function isApiStatusOfAnyObject(error: unknown, status: number): boolean {
  return isObject(error) && error.status === status
}
