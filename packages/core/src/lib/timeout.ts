export class TimeoutError extends Error {
  constructor(message = 'Connection timed out') {
    super(message)
    this.name = 'TimeoutError'
  }
}

/** Wraps a promise with a timeout. Rejects with TimeoutError if not resolved in time. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError()), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

/**
 * Races a promise against a timeout without throwing on timeout. Resolves
 * to `{ ok: true, value }` if the promise fulfills first, or `{ ok: false }`
 * when the timer wins. If the input promise rejects before the timeout,
 * that rejection propagates. The timer is cleared in both branches so no
 * pending setTimeout handle leaks into the JS event loop (which can keep
 * Node alive and cause jest "worker failed to exit gracefully" warnings).
 */
export async function raceWithTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<{ ok: true; value: T } | { ok: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      promise.then((value) => ({ ok: true as const, value })),
      new Promise<{ ok: false }>((resolve) => {
        timer = setTimeout(() => resolve({ ok: false }), ms)
      }),
    ])
    // If the timeout won, the original promise is still running.
    // Promise.race doesn't cancel it, so a later rejection would
    // become unhandled. Attach a no-op catch to swallow it.
    if (!result.ok) {
      promise.catch(() => {})
    }
    return result
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Races a promise against an AbortSignal. Resolves to `{ ok: true, value }`
 * if the promise fulfills first, or `{ ok: false }` when the signal fires.
 * With no signal supplied, awaits the promise normally.
 *
 * Intended for uncancellable native ops (RNFS.hash, RNFS.copyFile, native
 * thumbnail generators). The orphan keeps running on its native thread; a
 * no-op catch is attached so a later rejection doesn't surface as unhandled.
 */
export async function raceWithAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<{ ok: true; value: T } | { ok: false }> {
  if (!signal) {
    return { ok: true, value: await promise }
  }
  if (signal.aborted) {
    promise.catch(() => {})
    return { ok: false }
  }
  let onAbort: (() => void) | undefined
  try {
    const result = await Promise.race([
      promise.then((value) => ({ ok: true as const, value })),
      new Promise<{ ok: false }>((resolve) => {
        onAbort = () => resolve({ ok: false })
        signal.addEventListener('abort', onAbort, { once: true })
      }),
    ])
    if (!result.ok) {
      promise.catch(() => {})
    }
    return result
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}
