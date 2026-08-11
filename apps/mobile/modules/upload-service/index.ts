import { requireOptionalNativeModule } from 'expo'
import { AppRegistry, Platform } from 'react-native'

/**
 * Android foreground service that keeps the app's process out of the cached
 * state while an upload runs.
 *
 * On Android 14+ a cached process is frozen 10 seconds after entering that
 * state, suspending the JS thread that drives the upload loop. A running
 * `dataSync` foreground service prevents caching, so uploads continue with the
 * app backgrounded or the phone locked. The service moves no bytes itself.
 *
 * Every export is a no-op off Android: the native module declares no other
 * platform, so the optional require returns null and nothing reaches native.
 */
export type UploadServiceContent = {
  title: string
  text: string
  /** Files done so far. Clamped natively against `progressTotal`. */
  progressCurrent: number
  /** Files in the run. Zero or less renders an indeterminate bar. */
  progressTotal: number
}

/**
 * Code thrown by `start` when Android refuses: either the app was backgrounded
 * (forbidden since Android 12) or the 6-hour `dataSync` budget is spent
 * (Android 15+). Both mean the same to a caller: wait for the next foreground.
 */
export const START_NOT_ALLOWED = 'start-not-allowed'

type Subscription = { remove(): void }

type NativeModule = {
  isRunning(): boolean
  start(options: UploadServiceContent): void
  update(options: UploadServiceContent): void
  stop(): void
  addListener(event: 'onTimeout' | 'onStopped' | 'onRefused', listener: () => void): Subscription
}

const native =
  Platform.OS === 'android' ? requireOptionalNativeModule<NativeModule>('UploadService') : null

// The native module holds this headless task open while the service runs, so
// React Native keeps JS timers running with the activity paused. It does
// nothing and never finishes on its own, since the native side ends it when
// the service stops.
if (native) {
  AppRegistry.registerHeadlessTask('SiaUploadKeepAlive', () => () => new Promise<void>(() => {}))
}

/** Read from the service itself, so an OEM kill that skipped `onStopped` still reconciles. */
export function isUploadServiceRunning(): boolean {
  return native?.isRunning() ?? false
}

/** Only legal while the app is user-visible; throws `START_NOT_ALLOWED` otherwise. */
export function startUploadService(content: UploadServiceContent): void {
  native?.start(content)
}

/** No-op when the service is not running. */
export function updateUploadService(content: UploadServiceContent): void {
  native?.update(content)
}

export function stopUploadService(): void {
  native?.stop()
}

/**
 * Fires when Android reclaims the dataSync budget. The service is already
 * tearing down by then; the listener exists so JS stops trying to restart
 * until the next foreground.
 */
export function addUploadServiceTimeoutListener(listener: () => void): Subscription | null {
  return native?.addListener('onTimeout', listener) ?? null
}

/**
 * Fires on every teardown, including ones we did not initiate. An OEM battery
 * manager can kill the process without this arriving at all, which is why
 * callers reconcile against `isUploadServiceRunning` rather than trust it.
 */
export function addUploadServiceStoppedListener(listener: () => void): Subscription | null {
  return native?.addListener('onStopped', listener) ?? null
}

/**
 * Fires when Android refuses to run the service in the foreground after
 * `start` returned, as it can once the dataSync budget is spent. The service
 * stops at once. A caller treats it as `START_NOT_ALLOWED`: wait for the next
 * foreground.
 */
export function addUploadServiceRefusedListener(listener: () => void): Subscription | null {
  return native?.addListener('onRefused', listener) ?? null
}
