/*
 * Rate-limits repeated calls to one action: the first call in a quiet stretch
 * runs at once, a stream after it runs the action once per window, and a
 * trailing run catches whatever landed mid-window.
 */
export type Coalescer = {
  /** Runs now if no window is open, otherwise marks a run for the window's close. */
  trigger(): void
  /** Runs now and closes any open window, so the next trigger runs at once again. */
  flush(): void
  /** Closes any open window without running the marked run. */
  cancel(): void
}

export function createCoalescer(fn: () => void, windowMs: number): Coalescer {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending = false

  function openWindow() {
    timer = setTimeout(closeWindow, windowMs)
    // Node keeps the process alive for a pending timer; a marked run is never
    // a reason to stay up. Asserted because a DOM-typed build sees a number
    // here, where the method does not exist.
    ;(timer as { unref?: () => void }).unref?.()
  }

  function closeWindow() {
    timer = null
    if (pending) {
      pending = false
      fn()
      openWindow()
    }
  }

  return {
    trigger() {
      if (timer) {
        pending = true
        return
      }
      fn()
      openWindow()
    },
    flush() {
      if (timer) clearTimeout(timer)
      timer = null
      pending = false
      fn()
    },
    cancel() {
      if (timer) clearTimeout(timer)
      timer = null
      pending = false
    },
  }
}
