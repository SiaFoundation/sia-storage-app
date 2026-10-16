/*
 * autoKeepAwake — operation-scoped screen wake lock with a tagged intent set.
 *
 * Distinct from the user-facing "Keep Awake" toggle in settings.ts (tag
 * 'manual'), which is an always-on override. This service auto-acquires
 * during specific in-flight operations (initial sync gate, photo archive
 * import) and releases when they finish. Acquire is idempotent per tag
 * (Set semantics, not a counter), so callers pair acquire/release 1:1
 * and overlapping intents from different tags coexist. The two services
 * share the underlying expo-keep-awake API via separate tags ('auto' here,
 * 'manual' for the user toggle).
 *
 * Suspend behavior: the wake lock only matters in the foreground. On
 * background we deactivate the lock but keep the intent set; on
 * foreground return we reactivate if anything is still held. Callers that
 * also pause their work on suspend (e.g. archive walk) should still
 * release explicitly so a returning user with no in-flight ops doesn't
 * keep the screen on.
 */

import { logger } from '@siastorage/logger'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { addLifecycleListener, getLifecycle } from './lifecycle'

const KEEP_AWAKE_TAG = 'auto'

const heldTags = new Set<string>()
const heldListeners = new Set<(held: boolean) => void>()
let lockActive = false
let unsubscribeLifecycle: (() => void) | null = null

function notifyHeld(held: boolean): void {
  for (const listener of [...heldListeners]) {
    try {
      listener(held)
    } catch (error) {
      logger.warn('autoKeepAwake', 'held_listener_error', { error: error as Error })
    }
  }
}

function activateLock(): void {
  if (lockActive) return
  lockActive = true
  activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch((error) => {
    // Reset so the next acquire (or foreground transition) retries instead
    // of being short-circuited by the optimistic flag above.
    lockActive = false
    logger.warn('autoKeepAwake', 'activate_failed', { error: error as Error })
  })
}

function deactivateLock(): void {
  if (!lockActive) return
  lockActive = false
  try {
    deactivateKeepAwake(KEEP_AWAKE_TAG)
  } catch (error) {
    logger.warn('autoKeepAwake', 'deactivate_failed', { error: error as Error })
  }
}

// Lazy so callers that forget initAutoKeepAwake() still get correct
// suspend/resume behavior on the first acquire.
function ensureLifecycleSubscription(): void {
  if (unsubscribeLifecycle) return
  unsubscribeLifecycle = addLifecycleListener((next) => {
    if (next === 'background') {
      deactivateLock()
    } else if (heldTags.size > 0) {
      activateLock()
    }
  })
}

/** Adds an intent and activates the lock if the app is foregrounded. */
export function acquireAutoKeepAwake(tag: string): void {
  ensureLifecycleSubscription()
  const wasEmpty = heldTags.size === 0
  heldTags.add(tag)
  if (getLifecycle() === 'foreground') activateLock()
  if (wasEmpty) notifyHeld(true)
}

/** Removes an intent and deactivates the lock if no intents remain. */
export function releaseAutoKeepAwake(tag: string): void {
  const removed = heldTags.delete(tag)
  if (heldTags.size > 0) return
  deactivateLock()
  if (removed) notifyHeld(false)
}

/**
 * Subscribes to the intent set crossing empty, in either direction. Fires on
 * the crossing only, never per tag, and tracks intents rather than the lock:
 * a backgrounded app drops the lock while its intents stand.
 */
export function subscribeAutoKeepAwake(fn: (held: boolean) => void): () => void {
  heldListeners.add(fn)
  return () => {
    heldListeners.delete(fn)
  }
}

/** Returns whether any intent is currently held. */
export function isAutoKeepAwakeHeld(): boolean {
  return heldTags.size > 0
}

/** Wires the lifecycle listener up front; safe to call multiple times. */
export function initAutoKeepAwake(): void {
  ensureLifecycleSubscription()
}

export function __resetAutoKeepAwakeForTesting(): void {
  unsubscribeLifecycle?.()
  unsubscribeLifecycle = null
  heldTags.clear()
  heldListeners.clear()
  lockActive = false
}
