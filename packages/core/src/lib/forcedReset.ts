/*
 * Forced reset: a nonce per build variant that makes every app on that
 * variant, mobile, desktop and CLI, drop its local library on the next launch
 * and rebuild it from the network, keeping the user signed in. It is how a
 * build ships a schema change that installs of an earlier build of the same
 * variant already migrated past. Each app clears its own storage.
 *
 * Variants are independent, so a reset that has to reach every build means
 * changing all three nonces.
 */
import type { StorageAdapter } from '../adapters/storage'

export type BuildVariant = 'dev' | 'beta' | 'prod'

// null never resets. Any other value resets each install that has not recorded
// it, once. The value is arbitrary and only has to differ from the last one.
const RESET_NONCES: Record<BuildVariant, string | null> = {
  dev: null,
  beta: '3e9b02f6',
  prod: null,
}

const MARKER_KEYS: Record<BuildVariant, string> = {
  dev: 'completedDevResetNonce',
  beta: 'completedBetaResetNonce',
  prod: 'completedProdResetNonce',
}

/** Storage keys a reset keeps: the sign-in state and the reset markers themselves. */
export const RESET_KEEP_KEYS = ['hasOnboarded', 'indexerURL', ...Object.values(MARKER_KEYS)]

export type ForcedResetAction = 'reset' | 'record' | 'none'

/**
 * Anything but an exact dev or beta match is production, so a build that
 * cannot say what it is never resets on a beta nonce.
 */
export function resolveVariant(variant: unknown): BuildVariant {
  return variant === 'dev' || variant === 'beta' ? variant : 'prod'
}

export function selectForcedResetAction(
  nonce: string | null,
  marker: string,
  hasLocalData: boolean,
): ForcedResetAction {
  if (nonce === null || nonce === marker) return 'none'
  // With no local data there is nothing to rebuild, and recording here stops
  // the launch right after a first sign-in from resetting it.
  return hasLocalData ? 'reset' : 'record'
}

/** Call before the database is opened: a reset drops it. */
export async function resolveForcedReset(
  storage: Pick<StorageAdapter, 'getItem'>,
  variant: BuildVariant,
  hasLocalData: boolean,
): Promise<ForcedResetAction> {
  const marker = (await storage.getItem(MARKER_KEYS[variant])) ?? ''
  return selectForcedResetAction(RESET_NONCES[variant], marker, hasLocalData)
}

/**
 * Runs after any successful reset, user-triggered ones included: a marker left
 * behind resets the install again on the next launch.
 */
export async function recordForcedReset(
  storage: Pick<StorageAdapter, 'setItem'>,
  variant: BuildVariant,
): Promise<void> {
  const nonce = RESET_NONCES[variant]
  if (nonce !== null) await storage.setItem(MARKER_KEYS[variant], nonce)
}
