import { isAbortError } from '@siastorage/core/lib/errors'
import { delayWithSignal } from './delayWithSignal'

/** Run `fn` after `ms`. If the signal aborts during the delay, `fn` never runs. */
export async function scheduleAfter<T>(
  ms: number,
  signal: AbortSignal,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T | undefined> {
  try {
    await delayWithSignal(ms, signal)
  } catch (e) {
    if (isAbortError(e)) return undefined
    throw e
  }
  if (signal.aborted) return undefined
  return await fn(signal)
}
