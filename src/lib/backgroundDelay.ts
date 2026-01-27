import BackgroundTimer from 'react-native-background-timer'

// It appears that setTimeout does not work in background tasks on Android,
// so we use react-native-background-timer instead.
//
// This delay is abortable - when iOS fires the timeout callback, we need to
// immediately resolve any pending delay so the while loop can exit cleanly.
// Without this, the await delay() Promise stays pending while iOS suspends
// the app, causing the next background task to inherit stale state.

type AbortFn = () => void

export function createBackgroundDelay(): {
  delay: (ms: number) => Promise<'completed' | 'aborted'>
  abort: AbortFn
} {
  let pendingAbort: AbortFn | null = null

  const delay = (ms: number): Promise<'completed' | 'aborted'> => {
    return new Promise((resolve) => {
      const timerId = BackgroundTimer.setTimeout(() => {
        pendingAbort = null
        resolve('completed')
      }, ms)

      // Store abort function that cancels timer and resolves immediately
      pendingAbort = () => {
        BackgroundTimer.clearTimeout(timerId)
        pendingAbort = null
        resolve('aborted')
      }
    })
  }

  const abort: AbortFn = () => {
    pendingAbort?.()
  }

  return { delay, abort }
}
