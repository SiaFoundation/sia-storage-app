/**
 * Polling helpers. Every wait has a deadline, checked between probes, and
 * names what it waited for.
 */

export class WaitTimeout extends Error {}

/**
 * A wait for the apps themselves, such as two devices agreeing, timed out.
 * The runner reports it as FAIL. Any other WaitTimeout is the harness's own
 * wait, such as a lock, a server starting or a process exiting, and reports
 * as ERROR.
 */
export class AppTimeout extends WaitTimeout {}

/** Thrown by a wait whose scenario was cancelled, so the scenario stops at its next wait. */
export class Cancelled extends Error {}

/**
 * Polls `probe` until it returns a value other than undefined, null or false,
 * and returns that value. A probe that throws counts as not ready yet, and the
 * last error is quoted if the deadline passes.
 */
export async function waitFor<T>(
  what: string,
  probe: () => T | undefined | null | false | Promise<T | undefined | null | false>,
  opts: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 30_000
  const intervalMs = opts.intervalMs ?? 200
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  for (;;) {
    if (opts.signal?.aborted) throw new Cancelled(`Cancelled while waiting for ${what}`)
    try {
      const value = await probe()
      if (value !== undefined && value !== null && value !== false) return value
    } catch (e) {
      lastError = e
    }
    if (Date.now() >= deadline) {
      const why = lastError instanceof Error ? `: ${lastError.message}` : ''
      throw new WaitTimeout(`Timed out after ${timeoutMs}ms waiting for ${what}${why}`)
    }
    await Bun.sleep(intervalMs)
  }
}

/** Rethrows a WaitTimeout as an AppTimeout, for a wait on the apps' own behavior. */
export function asAppTimeout(e: unknown): never {
  throw e instanceof WaitTimeout && !(e instanceof AppTimeout) ? new AppTimeout(e.message) : e
}

/** A wait on the app's own behavior, whose timeout reports as FAIL. */
export function waitForApp<T>(
  what: string,
  probe: () => T | undefined | null | false | Promise<T | undefined | null | false>,
  opts: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  return waitFor(what, probe, opts).catch(asAppTimeout)
}
