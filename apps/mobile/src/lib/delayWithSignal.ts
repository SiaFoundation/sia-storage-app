import { AbortError } from '@siastorage/core/lib/errors'
import BackgroundTimer from 'react-native-background-timer'

/**
 * Abortable delay using react-native-background-timer (required because
 * setTimeout doesn't fire in iOS background tasks). Resolves after `ms`,
 * or rejects with an AbortError if the signal aborts — whichever comes
 * first. If the signal is already aborted when called, rejects immediately.
 *
 * Unlike the previous bespoke abort primitive, `signal.aborted` is sticky
 * so any subsequent check at a loop boundary observes the abort even if
 * no delay is in flight at the moment abort() is called.
 */
export function delayWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new AbortError())
  }
  return new Promise((resolve, reject) => {
    const timerId = BackgroundTimer.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      BackgroundTimer.clearTimeout(timerId)
      reject(new AbortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
