/*
 * Refreshes what the window reads from the daemon when the daemon answers
 * again after a stretch of not answering.
 *
 * A daemon that is paused, or too busy to answer, keeps its socket and the
 * main process's change stream open. Every read the window makes meanwhile
 * fails on the bridge's 15 second timeout, and SWR waits about twice as long
 * before each retry as before the last, so a few minutes into a stall the
 * next retry is minutes away. When the daemon answers again it sends no cache
 * message and no connection signal, since from its side nothing changed. A
 * window opened during the stall has never read the connection state, and
 * without a refresh it says "Connecting to indexer" until that retry lands.
 */

import type { AppCaches } from '@siastorage/core/app'

/**
 * Returns a function to call with each reachability answer. It calls
 * `onRecovered` on the first answer that the daemon is reachable after one or
 * more that it was not, and never for a daemon reachable from the first read.
 */
export function watchRecovery(onRecovered: () => void): (reachable: boolean) => void {
  let down = false
  return (reachable) => {
    if (!reachable) {
      down = true
      return
    }
    if (!down) return
    down = false
    onRecovered()
  }
}

/** Every cache a hook in the status view, the popover or setup reads from. */
export function refreshAfterStall(caches: AppCaches): void {
  void caches.connection.invalidateAll()
  void caches.sync.invalidateAll()
  void caches.uploads.invalidateAll()
  void caches.library.invalidateAll()
  void caches.directories.invalidateAll()
  void caches.settings.invalidateAll()
  void caches.shareLinks.invalidateAll()
}
