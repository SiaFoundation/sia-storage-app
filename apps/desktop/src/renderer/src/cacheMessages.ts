/*
 * Paces the daemon's library cache messages before they reach this window's
 * caches.
 *
 * Sync-down clears the library cache once per batch of events it applies, and
 * the daemon forwards every one. Each clear refetches every library hook the
 * window has mounted, and the status view mounts three whole-library queries:
 * the file count, the library size and the count of files not uploaded. A
 * long sync would rerun all three as fast as batches arrive.
 */

import type { IpcMessage } from '@siastorage/core/app'
import { createCoalescer } from '@siastorage/core/lib/coalescer'

/**
 * Passes every message to `apply` except a clear of the whole library cache,
 * which is applied at once in a quiet stretch and at most once per `windowMs`
 * after that, with a final one after a burst ends.
 */
export function paceLibraryClears(
  apply: (message: IpcMessage) => void,
  windowMs: number,
): (message: IpcMessage) => void {
  let latest: IpcMessage | null = null
  const library = createCoalescer(() => {
    if (latest) apply(latest)
  }, windowMs)
  return (message) => {
    if (
      message.path.length === 1 &&
      message.path[0] === 'library' &&
      message.method === 'invalidateAll'
    ) {
      latest = message
      library.trigger()
      return
    }
    apply(message)
  }
}
