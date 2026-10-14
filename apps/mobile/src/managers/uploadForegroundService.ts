/*
 * Runs the Android upload foreground service while the app has upload work,
 * so uploads keep going with the app backgrounded or the phone locked.
 *
 * On Android 14 and up a cached process, one with no visible screen and no
 * foreground service, is frozen 10 seconds after it becomes cached, which
 * stops the JS upload loop and the SDK's network threads with it. A running foreground service keeps the
 * process out of that state, so the uploader carries on as it does in front.
 *
 * Android forbids starting the service from the background, so it starts
 * while the app is on screen with work outstanding. A stop in the background
 * cannot be undone until the app comes back, so the service is held open on
 * progress, not on queue depth: the upload queue empties between an import
 * finishing and its thumbnails appearing, and stopping in that gap would
 * strand the rest of the backup. It stops when nothing has moved for
 * LINGER_MS and no upload or import is left, or when nothing has moved for
 * STALL_MS whatever is left.
 *
 * Off by default behind "Upload in the background" in the menu, and Wi-Fi
 * only. The background fetch job is scheduled with `requiredNetworkType:
 * NETWORK_TYPE_UNMETERED`, and a foreground service takes no such condition,
 * so this checks the network itself. Nothing here runs off Android.
 */

import NetInfo from '@react-native-community/netinfo'
import { logger } from '@siastorage/logger'
import { PermissionsAndroid, Platform } from 'react-native'
import {
  addUploadServiceRefusedListener,
  addUploadServiceStoppedListener,
  addUploadServiceTimeoutListener,
  isUploadServiceRunning,
  START_NOT_ALLOWED,
  startUploadService,
  stopUploadService,
  updateUploadService,
} from 'upload-service'
import { app, getUploadManager } from '../stores/appService'
import { getFileStatsLocal } from '../stores/files'
import { addLifecycleListener, getLifecycle } from './lifecycle'
import { onUploadWork } from './uploadWorkSignal'
import {
  registerBackgroundTaskLifecycle,
  releaseBackgroundTaskLifecycle,
  suspendForAndroidServiceStop,
} from './suspension'

const POLL_MS = 5_000
/**
 * Must exceed the thumbnail scanner's slowest idle interval of 60s, or the
 * service stops in the usual gap between originals finishing and their
 * thumbnails being made.
 */
export const LINGER_MS = 2 * 60_000
/**
 * How long the service keeps running with nothing moving at all. Set to
 * outlast copying and hashing one large video, during which no counter
 * moves. A stop in the background leaves the rest of the backup until the
 * app is next opened.
 */
export const STALL_MS = 10 * 60_000
export const FGS_TASK_ID = 'upload-foreground-service'
export const BACKGROUND_UPLOADS_SETTING = 'androidBackgroundUploads'

export type ServiceState = 'idle' | 'running' | 'waiting-for-foreground'

/** What the pipeline has produced so far. Any part moving forward is progress. */
type Progress = {
  uploaded: number
  packed: number
  /** Moves while a large file uploads, when the two above do not. */
  shards: number
  importing: number
  thumbs: number
}

let state: ServiceState = 'idle'
let lastProgress: Progress | null = null
let lastProgressAt = 0
// Set while a stop this manager asked for is on its way, so its onStopped is
// not read as Android stopping the service behind our back.
let stopping = false
// The poll in progress. A poll asked for while one runs makes it poll once
// more when it ends, since that one may have read the queue before the work
// that prompted the call was added.
let ticking: Promise<void> | null = null
let pollAgain = false
let poll: ReturnType<typeof setInterval> | null = null
const teardowns: Array<() => void> = []

export function getUploadServiceState(): ServiceState {
  return state
}

export async function isBackgroundUploadsEnabled(): Promise<boolean> {
  return (await app().storage.getItem(BACKGROUND_UPLOADS_SETTING)) === 'true'
}

/**
 * Turns background uploads on or off. Turning them on asks for the
 * notification permission Android 13 and up requires before the service's
 * notification shows in the drawer, and resolves false when it is refused.
 * The service runs either way, listed only under the system's active apps.
 */
export async function setBackgroundUploadsEnabled(enabled: boolean): Promise<boolean> {
  await app().storage.setItem(BACKGROUND_UPLOADS_SETTING, String(enabled))
  app().caches.settings.invalidate(BACKGROUND_UPLOADS_SETTING)
  const notifying = enabled ? await requestNotifications() : true
  void tick()
  return notifying
}

async function requestNotifications(): Promise<boolean> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return true
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
  ).catch(() => PermissionsAndroid.RESULTS.DENIED)
  return result === PermissionsAndroid.RESULTS.GRANTED
}

/** Files and thumbnails waiting to upload, for deciding whether work is left. */
async function pendingUploads(): Promise<number> {
  return (await getFileStatsLocal({ localOnly: true })).count
}

/** The notification counts files only, as the rest of the app does. */
async function notificationContent(importing: number) {
  const files = (await getFileStatsLocal({ localOnly: true, includeThumbnails: false })).count
  const left = files + importing
  return {
    title: 'Backing up',
    text: left === 1 ? '1 file left' : `${left.toLocaleString()} files left`,
    progressCurrent: 0,
    progressTotal: 0,
  }
}

async function sampleProgress(): Promise<Progress> {
  const uploader = getUploadManager()
  const { thumbs } = await app().thumbnails.queryProgress(app().thumbnails.allowedTypes)
  return {
    uploaded: uploader?.uploadedBytes ?? 0,
    packed: uploader?.packedBytes ?? 0,
    shards: uploader?.shardBytes ?? 0,
    importing: await app().imports.countInFlight(),
    thumbs,
  }
}

function moved(before: Progress, after: Progress): boolean {
  return (
    after.uploaded > before.uploaded ||
    after.packed > before.packed ||
    after.shards > before.shards ||
    after.importing < before.importing ||
    after.thumbs > before.thumbs
  )
}

async function onUnmeteredNetwork(): Promise<boolean> {
  const net = await NetInfo.fetch()
  return (
    net.isConnected === true &&
    (net.type === 'wifi' || net.type === 'ethernet') &&
    net.details?.isConnectionExpensive !== true
  )
}

async function start(pending: number, importing: number): Promise<void> {
  try {
    startUploadService(await notificationContent(importing))
  } catch (error) {
    if ((error as { code?: string }).code === START_NOT_ALLOWED) {
      state = 'waiting-for-foreground'
      logger.info('uploadService', 'start_refused')
      return
    }
    logger.warn('uploadService', 'start_failed', { error: error as Error })
    return
  }
  state = 'running'
  lastProgress = await sampleProgress()
  lastProgressAt = Date.now()
  logger.info('uploadService', 'started', { pending, importing })
  await registerBackgroundTaskLifecycle(FGS_TASK_ID)
}

/** After the service is gone, for whatever reason: lets suspension proceed and parks if backgrounded. */
async function afterStop(next: ServiceState, reason: string): Promise<void> {
  state = next
  lastProgress = null
  logger.info('uploadService', 'stopped', { reason })
  await releaseBackgroundTaskLifecycle(FGS_TASK_ID)
  // With the service gone the process is frozen within seconds of being in
  // the background, so park the uploader and drain the database first.
  if (getLifecycle() === 'background') await suspendForAndroidServiceStop()
}

async function stop(reason: string): Promise<void> {
  stopping = true
  stopUploadService()
  await afterStop('idle', reason)
}

function tick(): Promise<void> {
  if (ticking) {
    pollAgain = true
    return ticking
  }
  ticking = (async () => {
    do {
      pollAgain = false
      await runPoll()
    } while (pollAgain)
  })().finally(() => {
    ticking = null
  })
  return ticking
}

/** Only an idle service with the app in front has anything to decide. */
function checkForWork(): void {
  if (state === 'idle' && getLifecycle() === 'foreground') void tick()
}

async function runPoll(): Promise<void> {
  try {
    if (state === 'running') {
      // The service can stop without this JS hearing it, so read its own flag.
      if (!isUploadServiceRunning()) return await afterStop('idle', 'gone')
      if (!(await isBackgroundUploadsEnabled())) return await stop('disabled')
      if (!(await onUnmeteredNetwork())) return await stop('metered')

      const now = Date.now()
      const progress = await sampleProgress()
      if (lastProgress && moved(lastProgress, progress)) lastProgressAt = now
      lastProgress = progress
      const pending = await pendingUploads()
      const outstanding = pending > 0 || progress.importing > 0
      const quiet = now - lastProgressAt
      if (quiet >= STALL_MS) return await stop('stall')
      if (!outstanding && quiet >= LINGER_MS) return await stop('idle')
      updateUploadService(await notificationContent(progress.importing))
      return
    }

    if (state === 'idle') {
      if (getLifecycle() !== 'foreground') return
      if (!(await isBackgroundUploadsEnabled())) return
      if (!(await onUnmeteredNetwork())) return
      const pending = await pendingUploads()
      const importing = await app().imports.countInFlight()
      if (pending === 0 && importing === 0) return
      await start(pending, importing)
    }
  } catch (error) {
    logger.warn('uploadService', 'tick_failed', { error: error as Error })
  }
}

export function initUploadForegroundService(): void {
  if (Platform.OS !== 'android' || poll !== null) return
  // A JS reload in development runs this over a process whose service is
  // still up, so the state comes from the service, not from a fresh start.
  if (isUploadServiceRunning()) {
    state = 'running'
    lastProgressAt = Date.now()
    void registerBackgroundTaskLifecycle(FGS_TASK_ID)
  }
  const waitForForeground = (reason: string) => () => {
    // Android ended or refused the service, which is already stopping. It
    // resets the dataSync time limit when the user next opens the app.
    stopping = true
    void afterStop('waiting-for-foreground', reason)
  }
  const onTimeout = addUploadServiceTimeoutListener(waitForForeground('budget'))
  // Android refused to run the service in the foreground after start returned.
  const onRefused = addUploadServiceRefusedListener(waitForForeground('refused'))
  const onStopped = addUploadServiceStoppedListener(() => {
    if (stopping) {
      stopping = false
      return
    }
    // Swiped off recents, or stopped by the system. No restart until the
    // app is in front again, which the start rule requires anyway.
    if (state === 'running') void afterStop('idle', 'external')
  })
  teardowns.push(
    () => onTimeout?.remove(),
    () => onRefused?.remove(),
    () => onStopped?.remove(),
    addLifecycleListener((next) => {
      if (next !== 'foreground') return
      if (state === 'waiting-for-foreground') state = 'idle'
      void tick()
    }),
    // Files added just before the phone locks would otherwise wait for the
    // next poll, which finds the app in the background, where Android refuses
    // the start. Imports are staged without a library change, so they come
    // through the upload work signal.
    app().caches.libraryVersion.subscribe(checkForWork),
    onUploadWork(checkForWork),
  )
  // A plain interval, not one the suspension scheduler owns: these timers are
  // what stop the service and release its wake lock, so a suspend must not
  // pause them.
  poll = setInterval(() => void tick(), POLL_MS)
  void tick()
}

/**
 * Stops the service along with its poll. The uploader shuts down with the
 * app, so a service left running would hold the wake lock and the
 * notification with nothing uploading behind them.
 */
export async function shutdownUploadForegroundService(): Promise<void> {
  // Listeners and the poll go first, so no new poll can start the service
  // again behind this stop. A poll already running is waited for.
  for (const teardown of teardowns) teardown()
  teardowns.length = 0
  clearTimers()
  await ticking
  stopping = false
  if (state !== 'running') return
  stopUploadService()
  state = 'idle'
  lastProgress = null
  await releaseBackgroundTaskLifecycle(FGS_TASK_ID)
}

function clearTimers(): void {
  if (poll !== null) clearInterval(poll)
  poll = null
}

export function __resetUploadForegroundServiceForTesting(): void {
  clearTimers()
  for (const teardown of teardowns) teardown()
  teardowns.length = 0
  state = 'idle'
  lastProgress = null
  lastProgressAt = 0
  stopping = false
  ticking = null
  pollAgain = false
}

/** Runs one poll now, for tests that drive the clock themselves. */
export function __tickForTesting(): Promise<void> {
  return tick()
}
