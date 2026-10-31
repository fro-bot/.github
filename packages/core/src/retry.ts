/**
 * One retry loop for the control plane. The caller supplies the policy (how many attempts, how long
 * to wait, which failures are worth another go), so every caller keeps its own numbers and
 * predicates; this module owns only the loop.
 *
 * An attempt can fail by throwing or by returning a value the caller wants to try again (a PR whose
 * mergeable state is still `unknown`, a compare-and-swap that lost). Both kinds are retried the same
 * way. The last attempt is never asked: its error is thrown, and its value is returned, exactly as
 * the operation produced it, so a caller maps an exhausted outcome to its own error or result.
 */

export interface RetryPolicy<T> {
  /** Total attempts, the first included. An integer of at least 1. */
  readonly attempts: number
  /**
   * Milliseconds to wait after failed attempt `attempt` (1-based) before the next. Omitted, zero or
   * negative means no wait and no call to `sleep`.
   */
  readonly delayMs?: (attempt: number) => number
  /** Whether a thrown error earns another attempt. Defaults to never. Not asked on the last attempt. */
  readonly shouldRetry?: (error: unknown, attempt: number) => boolean
  /** Whether a returned value earns another attempt. Defaults to never. Not asked on the last attempt. */
  readonly retryResult?: (result: T, attempt: number) => boolean
  /** Runs after `shouldRetry` says yes and before the wait. A failure here ends the retrying. */
  readonly onRetry?: (error: unknown, attempt: number) => void | Promise<void>
  /** Makes the wait. Defaults to a `setTimeout`, looked up when it is used. */
  readonly sleep?: (ms: number) => Promise<void>
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise<void>(resolve => {
    setTimeout(resolve, ms)
  })
}

/**
 * Runs `operation(attempt)` up to `policy.attempts` times and returns the first outcome that is not
 * retried. Throws a `RangeError`, before any attempt, when `attempts` is not an integer >= 1.
 */
export async function retry<T>(operation: (attempt: number) => Promise<T>, policy: RetryPolicy<T>): Promise<T> {
  const {attempts} = policy
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new RangeError(`retry attempts must be an integer >= 1, got ${String(attempts)}`)
  }

  const sleep = policy.sleep ?? defaultSleep
  const pause = async (attempt: number): Promise<void> => {
    const ms = policy.delayMs?.(attempt) ?? 0
    if (ms > 0) await sleep(ms)
  }

  // The attempt numbers are listed up front instead of counted in the loop: a loop counter that went
  // the wrong way would spin forever, which Stryker reports as a timeout and not as a failing test.
  const retriedAttempts = Array.from({length: attempts - 1}, (_, index) => index + 1)
  for (const attempt of retriedAttempts) {
    let result: T
    try {
      result = await operation(attempt)
    } catch (error: unknown) {
      if (!(policy.shouldRetry?.(error, attempt) ?? false)) throw error
      await policy.onRetry?.(error, attempt)
      await pause(attempt)
      continue
    }
    if (!(policy.retryResult?.(result, attempt) ?? false)) return result
    await pause(attempt)
  }

  return operation(attempts)
}
