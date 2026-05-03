import { requireOptionalNativeModule } from 'expo'
import { Platform } from 'react-native'

type NativeModule = {
  getSeconds(): number
}

// Optional require so a stale native build / non-iOS platform doesn't
// crash imports. Module is iOS-only — Android has no analog of
// UIApplication.backgroundTimeRemaining.
const native = requireOptionalNativeModule<NativeModule>('BackgroundTimeRemaining')

/**
 * Returns iOS's remaining background execution time in milliseconds.
 *
 * On iOS, this is `UIApplication.backgroundTimeRemaining` * 1000:
 * - Foregrounded: ~`Number.MAX_VALUE` (effectively infinite).
 * - Just after `applicationDidEnterBackground` with no extension:
 *   counts down from the natural ~5s grace.
 * - Inside an active `beginBackgroundTask` assertion: counts down
 *   from whatever iOS granted (~30s baseline, less under pressure).
 *
 * On Android (or if the native module isn't loaded for any reason),
 * returns `Number.POSITIVE_INFINITY` so callers treat it as "no cap".
 */
export function getBackgroundTimeRemainingMs(): number {
  if (Platform.OS !== 'ios' || !native) return Number.POSITIVE_INFINITY
  return native.getSeconds() * 1000
}
