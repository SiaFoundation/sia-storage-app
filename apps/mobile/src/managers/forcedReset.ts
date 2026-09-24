/*
 * The mobile side of the forced reset in core: which variant this build is,
 * and the app's own storage to read and record the marker in.
 */

import Constants from 'expo-constants'
import {
  type ForcedResetAction,
  recordForcedReset as recordForVariant,
  resolveForcedReset as resolveForVariant,
  resolveVariant,
} from '@siastorage/core/lib/forcedReset'
import { app } from '../stores/appService'

/**
 * `extra.variant` is set by the same resolveVariant() in variants.js that picks
 * the bundle id, so a build claiming 'beta' is the one published as
 * sia.storage.beta, which cannot ship in place of sia.storage.
 */
function buildVariant() {
  return resolveVariant(Constants.expoConfig?.extra?.variant)
}

/** Call before the database is opened: a reset drops the file and re-migrates. */
export async function resolveForcedReset(hasOnboarded: boolean): Promise<ForcedResetAction> {
  return resolveForVariant(app().storage, buildVariant(), hasOnboarded)
}

export async function recordForcedReset(): Promise<void> {
  await recordForVariant(app().storage, buildVariant())
}
