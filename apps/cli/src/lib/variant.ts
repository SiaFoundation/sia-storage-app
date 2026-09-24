/*
 * Which build of the CLI this is. A release candidate is a beta build: like
 * the beta desktop app it keeps its library in `~/.sia-beta`, and like every
 * beta app it answers the beta reset nonce, so installing one never touches
 * the production library. A daemon the desktop app spawns is told the app's
 * variant instead.
 */
import { type BuildVariant, resolveVariant } from '@siastorage/core/lib/forcedReset'
import { cliVersion } from './version'

export function cliVariant(): BuildVariant {
  const named = process.env.SIA_BUILD_VARIANT
  if (named) return resolveVariant(named)
  return cliVersion().includes('-') ? 'beta' : 'prod'
}
