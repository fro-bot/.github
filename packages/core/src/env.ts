/**
 * Reads a required environment variable. An empty value counts as missing, because a workflow that
 * passes an unset secret gives the process an empty string, not an absent variable.
 *
 * The error is the caller's: `missing` receives the variable name and returns the error to throw, so
 * a caller keeps its own message and error class. Without it the error is `<NAME> is required`.
 */

export interface RequiredEnvOptions {
  /** Builds the error thrown for a missing or empty variable. */
  readonly missing?: (name: string) => Error
}

export function requiredEnv(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  options: RequiredEnvOptions = {},
): string {
  const value = env[name]
  if (value === undefined || value === '') {
    throw options.missing === undefined ? new Error(`${name} is required`) : options.missing(name)
  }
  return value
}
