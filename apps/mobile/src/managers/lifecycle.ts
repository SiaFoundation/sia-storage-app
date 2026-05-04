import { logger } from '@siastorage/logger'
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native'

export type Lifecycle = 'foreground' | 'background'

/**
 * Maps an `AppState` raw value to our two-state lifecycle.
 *
 * 'active' and 'inactive' both map to 'foreground'. Per Apple, 'inactive'
 * is a foreground sub-state (banner notification, Control Center swipe,
 * Face ID prompt, screen lock, incoming call). The app cannot transition
 * directly from 'inactive' to suspended; it always passes through
 * 'background' first, so 'inactive' carries zero kill risk.
 *
 * 'unknown' / 'extension' map to 'background'. iOS BG-task cold starts
 * surface 'unknown' before the first AppState change event; treating it
 * as background is what lets the suspension manager actually suspend
 * after a BG task releases its lifecycle (`maybeSuspend` requires
 * `appState === 'background'`).
 */
export function deriveLifecycle(s: AppStateStatus): Lifecycle {
  return s === 'active' || s === 'inactive' ? 'foreground' : 'background'
}

type LifecycleListener = (next: Lifecycle, prev: Lifecycle) => void
type FocusListener = () => void

let current: Lifecycle | null = null
const lifecycleListeners = new Set<LifecycleListener>()
const focusListeners = new Set<FocusListener>()
let subscription: NativeEventSubscription | null = null

function readCurrent(): Lifecycle {
  if (current === null) current = deriveLifecycle(AppState.currentState)
  return current
}

// Listener throws are caught and logged so one buggy subscriber can't
// strand the rest of the chain. A lifecycle listener throwing would
// otherwise prevent the focus signal from queuing, leaving SWR fetchers
// without a retry signal until the next foreground transition.
function safeInvoke(fn: () => void, kind: 'lifecycle' | 'focus'): void {
  try {
    fn()
  } catch (error) {
    logger.warn('lifecycle', 'listener_error', { kind, error: error as Error })
  }
}

function handleChange(rawState: AppStateStatus): void {
  const next = deriveLifecycle(rawState)
  const prev = readCurrent()
  if (next === prev) return
  current = next
  // Snapshot before iterating so a listener that subscribes/unsubscribes
  // doesn't change the set of recipients for THIS transition.
  for (const listener of [...lifecycleListeners]) {
    safeInvoke(() => listener(next, prev), 'lifecycle')
  }
  // Microtask defers focus dispatch until after the current task settles.
  // Two reasons: (1) any subsystem listening to lifecycle (e.g. the
  // suspension manager queueing doResume) finishes its sync work first;
  // (2) a focus listener that re-reads `current` sees the latest value.
  if (next === 'foreground') {
    queueMicrotask(() => {
      for (const listener of [...focusListeners]) {
        safeInvoke(listener, 'focus')
      }
    })
  }
}

/**
 * Attaches the singleton AppState listener. Idempotent — repeat calls
 * return the same teardown without double-subscribing. Returns a teardown
 * that detaches the AppState subscription and clears all listeners.
 *
 * Most callers don't need to invoke this directly; `addLifecycleListener`
 * and `addForegroundFocusListener` auto-init on first subscription.
 */
export function initLifecycle(): () => void {
  if (subscription) return teardown
  current = deriveLifecycle(AppState.currentState)
  subscription = AppState.addEventListener('change', handleChange)
  return teardown
}

function teardown(): void {
  if (subscription) {
    subscription.remove()
    subscription = null
  }
  lifecycleListeners.clear()
  focusListeners.clear()
  current = null
}

/** Returns the current lifecycle state. Initializes lazily on first read. */
export function getLifecycle(): Lifecycle {
  return readCurrent()
}

/**
 * Subscribes to lifecycle transitions ('foreground' ↔ 'background').
 * Same-state events ('active' ↔ 'inactive') are filtered out and never
 * fire. Auto-initializes the AppState listener. Returns an unsubscribe.
 */
export function addLifecycleListener(fn: LifecycleListener): () => void {
  initLifecycle()
  lifecycleListeners.add(fn)
  return () => {
    lifecycleListeners.delete(fn)
  }
}

/**
 * Subscribes to foreground focus events. Fires once per transition INTO
 * foreground, on a microtask after lifecycle listeners have run. This is
 * the SWR focus signal — guarantees a refetch attempt after every real
 * background → foreground return. Auto-initializes. Returns an unsubscribe.
 */
export function addForegroundFocusListener(fn: FocusListener): () => void {
  initLifecycle()
  focusListeners.add(fn)
  return () => {
    focusListeners.delete(fn)
  }
}

/** Test-only: tears down the singleton subscription and clears all
 * listeners so each test starts with fresh module state. */
export function __resetLifecycleForTesting(): void {
  teardown()
}
