/*
 * Forced reset: a nonce per build variant that makes a device reset its local
 * data on the next launch, keeping the user signed in.
 *
 * Variants are independent, so a reset that has to reach every build means
 * changing all three nonces.
 */

import Constants from 'expo-constants'
import { app } from '../stores/appService'

export type Variant = 'dev' | 'beta' | 'prod'

// null never resets. Any other value resets each device that has not recorded
// it, once; the value is arbitrary and only has to differ from the last one.
const RESET_NONCES: Record<Variant, string | null> = {
  dev: null,
  beta: '3e9b02f6',
  prod: null,
}

const MARKER_KEYS: Record<Variant, string> = {
  dev: 'completedDevResetNonce',
  beta: 'completedBetaResetNonce',
  prod: 'completedProdResetNonce',
}

/** Every marker key, for the reset flow's storage keep list. */
export const RESET_MARKER_KEYS = Object.values(MARKER_KEYS)

export type ForcedResetAction = 'reset' | 'record' | 'none'

/**
 * Anything but an exact dev or beta match is production. `extra.variant` is set
 * by the same resolveVariant() in variants.js that picks the bundle id, so a
 * build claiming 'beta' is the one published as sia.storage.beta, which cannot
 * ship in place of sia.storage.
 */
export function resolveVariant(variant: unknown): Variant {
  return variant === 'dev' || variant === 'beta' ? variant : 'prod'
}

function buildVariant(): Variant {
  return resolveVariant(Constants.expoConfig?.extra?.variant)
}

export function selectForcedResetAction(
  nonce: string | null,
  marker: string,
  hasOnboarded: boolean,
): ForcedResetAction {
  if (nonce === null || nonce === marker) return 'none'
  // Before onboarding there is nothing to rebuild, and recording here stops the
  // initApp right after sign-in from resetting the account just created.
  return hasOnboarded ? 'reset' : 'record'
}

/** Call before the database is opened: a reset drops the file and re-migrates. */
export async function resolveForcedReset(hasOnboarded: boolean): Promise<ForcedResetAction> {
  const variant = buildVariant()
  const marker = (await app().storage.getItem(MARKER_KEYS[variant])) ?? ''
  return selectForcedResetAction(RESET_NONCES[variant], marker, hasOnboarded)
}

/**
 * Runs after any successful reset, user-triggered ones included: a marker left
 * behind resets the device again on the next launch.
 */
export async function recordForcedReset(): Promise<void> {
  const variant = buildVariant()
  const nonce = RESET_NONCES[variant]
  if (nonce !== null) await app().storage.setItem(MARKER_KEYS[variant], nonce)
}
