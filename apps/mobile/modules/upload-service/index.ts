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
 * Every export does nothing off Android, where `native` is null.
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
 * Code thrown by `start` when Android refuses to start a foreground service,
 * as it does from the background since Android 12. A caller waits for the
 * next foreground.
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

/** Read from the service itself, so it is false once the service has stopped, whether or not `onStopped` was heard. */
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
 * Fires when Android ends the service at the 6-hour dataSync limit, on Android
 * 15 and later. The service is already stopping, so the listener only stops
 * JS restarting it before the next foreground.
 */
export function addUploadServiceTimeoutListener(listener: () => void): Subscription | null {
  return native?.addListener('onTimeout', listener) ?? null
}

/** Fires on every teardown, including ones the app did not ask for. */
export function addUploadServiceStoppedListener(listener: () => void): Subscription | null {
  return native?.addListener('onStopped', listener) ?? null
}

/**
 * Fires when Android refuses to run the service in the foreground after
 * `start` returned, as Android 15 and later do once the dataSync time limit is
 * used up. The service stops at once, and a caller treats it like
 * `START_NOT_ALLOWED`.
 */
export function addUploadServiceRefusedListener(listener: () => void): Subscription | null {
  return native?.addListener('onRefused', listener) ?? null
}
