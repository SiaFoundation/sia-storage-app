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
let lockActive = false
let unsubscribeLifecycle: (() => void) | null = null

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
  heldTags.add(tag)
  if (getLifecycle() === 'foreground') activateLock()
}

/** Removes an intent and deactivates the lock if no intents remain. */
export function releaseAutoKeepAwake(tag: string): void {
  heldTags.delete(tag)
  if (heldTags.size === 0) deactivateLock()
}

/** Wires the lifecycle listener up front; safe to call multiple times. */
export function initAutoKeepAwake(): void {
  ensureLifecycleSubscription()
}

export function __resetAutoKeepAwakeForTesting(): void {
  unsubscribeLifecycle?.()
  unsubscribeLifecycle = null
  heldTags.clear()
  lockActive = false
}
