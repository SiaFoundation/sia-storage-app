import { minutesInMs, secondsInMs } from '@siastorage/core'
import { BACKGROUND_TASK_OFFLINE_GRACE, BACKGROUND_TASK_STALL_LIMIT } from '@siastorage/core/config'
import { isAbortError } from '@siastorage/core/lib/errors'
import { logger } from '@siastorage/logger'
import { Platform } from 'react-native'
import BackgroundFetch, { type BackgroundFetchConfig } from 'react-native-background-fetch'
import { delayWithSignal } from '../lib/delayWithSignal'
import { app } from '../stores/appService'
import { getFileStatsLocal } from '../stores/files'
import { clearActiveBgTask, setActiveBgTask } from './bgTaskContext'
import { runFsEvictionScanner } from './fsEvictionScanner'
import { runFsOrphanScanner } from './fsOrphanScanner'
import { getLifecycle } from './lifecycle'
import { registerBackgroundTaskLifecycle, releaseBackgroundTaskLifecycle } from './suspension'
import { getPhotosScannedCount, isArchiveWalkActive } from './syncPhotosArchive'
import { triggerSyncDownEvents } from './syncDownEvents'
import { getUploadManager } from './uploader'

/**
 * Background tasks are scheduled by the operating system and run for about the following durations:
 * - iOS:
 *   - App Refresh Task: 30 seconds (hard limit)
 *   - Processing Task: ~5 minutes (approximately 295 seconds, system-controlled, not officially documented)
 * - Android:
 *   - Background Task: 10 minutes (hard limit)
 */

type TaskId =
  | 'com.transistorsoft.fetch'
  | 'com.transistorsoft.processing'
  | 'react-native-background-fetch'

type TaskConfig = {
  id: TaskId
  type: 'BGAppRefreshTask' | 'BGProcessingTask' | 'BackgroundTask'
}

type TaskState = {
  startTime: number
  status: 'running' | 'finished'
  invocationId: string
  controller?: AbortController
}
const taskConfigs: Record<TaskId, TaskConfig> = {
  // This is the library's default task ID on Android.
  'react-native-background-fetch': {
    id: 'react-native-background-fetch',
    type: 'BackgroundTask',
  },
  // This is the library's default task ID on iOS, this is always a BGAppRefreshTask.
  'com.transistorsoft.fetch': {
    id: 'com.transistorsoft.fetch',
    type: 'BGAppRefreshTask',
  },
  // We have an additional custom task on iOS since the default task is a BGAppRefreshTask
  // which only runs for 30 seconds, custom tasks use BGProcessingTask.
  'com.transistorsoft.processing': {
    id: 'com.transistorsoft.processing',
    type: 'BGProcessingTask',
  },
}

/**
 * Constraints applied to JS-side task scheduling. The library types/README
 * label every field [Android only], but the iOS bridge maps a subset for
 * BGProcessingTask (see scheduleTask call below). For BGAppRefreshTask
 * (configure), Apple's API has no constraint properties — iOS ignores
 * all four and picks fire times itself. See
 * node_modules/react-native-background-fetch/ios/RNBackgroundFetch/RNBackgroundFetch.m.
 */
const sharedConfig: BackgroundFetchConfig = {
  // Android only. iOS BGProcessingTask uses requiresNetworkConnectivity (set per-task below).
  requiredNetworkType: BackgroundFetch.NETWORK_TYPE_UNMETERED,
  // Android only. iOS has no equivalent on either task type.
  requiresBatteryNotLow: true,
  // Android: WorkManager constraint. iOS BGProcessingTask: forwarded as
  // BGProcessingTaskRequest.requiresExternalPower, which also disables
  // iOS's 80%-CPU-over-60s monitor — fixes our cpu_resource_fatal crashes.
  // iOS BGAppRefreshTask: ignored (no-op).
  requiresCharging: true,
  // Android only.
  requiresDeviceIdle: false,
}

const taskStates: Record<TaskId, TaskState> = {
  'com.transistorsoft.fetch': createFreshTaskState(),
  'com.transistorsoft.processing': createFreshTaskState(),
  'react-native-background-fetch': createFreshTaskState(),
}

function createFreshTaskState(): TaskState {
  return {
    startTime: 0,
    status: 'finished',
    invocationId: '',
    controller: undefined,
  }
}

/**
 * Reset a specific task's state, aborting any pending operations.
 */
function resetTaskState(taskId: TaskId) {
  const state = taskStates[taskId]
  // Abort any pending work from a previous invocation.
  state.controller?.abort()
  Object.assign(state, createFreshTaskState())
}

/**
 * Reset all task states, aborting any pending operations.
 * Called on init to ensure clean startup.
 */
function resetAllTaskStates() {
  for (const taskId of Object.keys(taskStates) as TaskId[]) {
    resetTaskState(taskId)
  }
}

export async function initBackgroundTasks() {
  logger.info('backgroundTask', 'init')

  // Clean up any stale state from previous initialization
  resetAllTaskStates()

  const status = await BackgroundFetch.configure(
    {
      minimumFetchInterval: 15,
      ...sharedConfig,
    },
    async (taskId: string) => {
      const config = taskConfigs[taskId as TaskId]
      const state = taskStates[taskId as TaskId]
      if (!config || !state) {
        logger.warn('backgroundTask', 'unknown_task_id', { taskId })
        BackgroundFetch.finish(taskId)
        return
      }

      // Reset state for this task to ensure fresh start, aborting any
      // lingering work from a previous invocation.
      resetTaskState(taskId as TaskId)

      transitionTaskState(state, 'running', config)
      // Capture our invocation id so a later re-invocation that resets
      // shared state can't trick us into finalizing on its behalf.
      const myInvocationId = state.invocationId
      const log = logTask(config, state)
      log('handler_enter', { path: 'normal' })
      try {
        await runBackgroundWork(config, state)
      } catch (error) {
        log('work_error', { error: error as Error })
      } finally {
        if (state.invocationId !== myInvocationId) {
          // A newer invocation has taken over this task slot; it owns
          // its own finalization.
          log('handler_exit', { path: 'normal', skipped: 'superseded' })
        } else if (state.status === 'finished') {
          // Timeout path already finalized this invocation — calling
          // finish/release again logs an iOS warning and enqueues
          // redundant suspend work.
          log('handler_exit', { path: 'normal', skipped: 'already_finalized' })
        } else {
          transitionTaskState(state, 'finished', config)
          // Run the suspension drain BEFORE releasing the iOS BG-task
          // assertion. The drain caps itself on whatever budget iOS
          // actually allocates this invocation (read via
          // backgroundTimeRemaining), so finish() lands once SQLite locks
          // are released — fixes 0xDEAD10CC. We're still inside the
          // BGTask handler's runloop cycle here, so the drain has the
          // task's full remaining wake window to work with.
          try {
            await releaseBackgroundTaskLifecycle(config.id)
          } catch (error) {
            log('release_error', { error: error as Error })
          }
          BackgroundFetch.finish(config.id)
          log('handler_exit', { path: 'normal' })
        }
      }
    },
    async (taskId: string) => {
      const config = taskConfigs[taskId as TaskId]
      const state = taskStates[taskId as TaskId]
      if (!config || !state) {
        logger.warn('backgroundTask', 'unknown_task_id', { taskId })
        BackgroundFetch.finish(taskId)
        return
      }
      const log = logTask(config, state)
      // If the normal path already finalized this invocation (or none is
      // running), there's nothing left to clean up — and finish() must
      // not be called twice.
      if (state.status !== 'running') {
        log('timeout', { skipped: 'no_active_invocation' })
        return
      }
      log('handler_enter', { path: 'timeout' })
      log('timeout')

      // Abort the work loop. signal.aborted is sticky so the loop bails
      // at its next await-point even if no delayWithSignal is in flight.
      state.controller?.abort()
      transitionTaskState(state, 'finished', config)
      log('timeout_finished', { elapsedMs: Date.now() - state.startTime })

      // Drain the DB before releasing the BG-task assertion. The drain
      // reads UIApplication.backgroundTimeRemaining each iteration and
      // bails before the iOS budget runs out, so finish() lands inside
      // the ~5s expiration grace even under memory pressure. We can't
      // wrap with withIosExecutionTime here — the await yields the
      // runloop and per Apple DTS 126438 beginBackgroundTask is only
      // reliably honored in the same runloop cycle as the wake.
      try {
        await releaseBackgroundTaskLifecycle(config.id)
      } catch (error) {
        log('release_error', { error: error as Error })
      }
      BackgroundFetch.finish(config.id)
      log('handler_exit', { path: 'timeout' })
    },
  )

  logger.info('backgroundTask', 'configured', { status })

  // Schedule custom background processing task on iOS.
  if (Platform.OS === 'ios') {
    const bgProcessingTaskConfig = taskConfigs['com.transistorsoft.processing']
    try {
      const scheduled = await BackgroundFetch.scheduleTask({
        taskId: bgProcessingTaskConfig.id,
        periodic: true,
        delay: minutesInMs(31),
        ...sharedConfig,
        // iOS BGProcessingTask only — bridge forwards as
        // BGProcessingTaskRequest.requiresNetworkConnectivity. Android's
        // network constraint comes from requiredNetworkType in sharedConfig.
        requiresNetworkConnectivity: true,
      })
      logger.info('backgroundTask', 'task_scheduled', {
        taskId: bgProcessingTaskConfig.id,
        scheduled,
      })
    } catch (error) {
      logger.error('backgroundTask', 'schedule_failed', {
        taskId: bgProcessingTaskConfig.id,
        error: error as Error,
      })
    }
  }
}

/**
 * Poll app init state every second, bounded by a 30s timeout.
 * Returns 'ready' when init completes, 'timeout' after 30s, or 'aborted'.
 */
async function waitForInitialization(
  signal: AbortSignal,
): Promise<'ready' | 'timeout' | 'aborted'> {
  const maxWaitMs = secondsInMs(30)
  const pollIntervalMs = secondsInMs(1)
  let elapsed = 0

  while (app().init.getState().isInitializing && elapsed < maxWaitMs) {
    try {
      await delayWithSignal(pollIntervalMs, signal)
    } catch (e) {
      if (isAbortError(e)) return 'aborted'
      throw e
    }
    elapsed += pollIntervalMs
  }

  if (app().init.getState().isInitializing) {
    return 'timeout'
  }
  return 'ready'
}

// Soft deadline per task type, leaving headroom inside the OS budget for
// release + suspend cleanup. iOS does NOT reliably extend a BGTask via
// beginBackgroundTask from inside the expirationHandler (Apple DTS forum
// thread 126438), so cleanup must complete inside the task's wake window.
// BGAppRefreshTask: 30s hard cap (WWDC 2019 Session 707) → 5s reserved.
// BGProcessingTask: no documented cap; ~5min is empirical convention →
// 25s reserved. BackgroundTask (Android Worker): 10min hard cap → 30s.
function softDeadlineMs(type: TaskConfig['type']): number {
  switch (type) {
    case 'BGAppRefreshTask':
      return secondsInMs(25)
    case 'BGProcessingTask':
      return secondsInMs(270)
    case 'BackgroundTask':
      return minutesInMs(9) + secondsInMs(30)
  }
}

/**
 * Work the app's own services finish while it stays awake. Thumbnails are left
 * out because one whose original is not on the device can never be made, and
 * counting them would hold every task to its deadline.
 */
type PendingWork = {
  filesRemaining: number
  bytesRemaining: number
  activeUploads: number
  importing: boolean
  /** Bytes the import copies in progress have written. */
  importBytesCopied: number
  /** Photos the library walk has looked at, which moves past ones already imported. */
  archiveScanned: number
  metadataSyncUp: number
  syncingDown: boolean
  /** No sync-down run has finished since the task started. */
  syncDownUnchecked: boolean
  /** Where sync-down has read up to, as JSON. */
  syncDownCursor: string
}

/**
 * Reads what is still pending. Uploads count the files waiting and any the
 * uploader holds that no longer count as waiting, such as a file a newer
 * version superseded mid-upload. Imports count while a file is being copied,
 * a file is ready to copy now, or the photo library walk is still finding
 * files, so a task does not wait out an import's retry backoff. Sync-down
 * counts until one run has finished since the task started, because a quiet
 * check finds no events and leaves nothing else to see.
 */
async function readPendingWork(
  longTask: boolean,
  syncDownRunsAtStart: number,
): Promise<PendingWork> {
  if (!longTask) {
    const stats = await getFileStatsLocal({ localOnly: true })
    return {
      filesRemaining: stats.count,
      bytesRemaining: stats.totalBytes,
      activeUploads: app().uploads.getActiveIds().length,
      importing: false,
      importBytesCopied: 0,
      archiveScanned: 0,
      metadataSyncUp: 0,
      syncingDown: false,
      syncDownUnchecked: false,
      syncDownCursor: '',
    }
  }
  // Imports are read before uploads. A file an import finishes between the
  // two reads then shows as waiting to upload, where the other order would
  // miss it in both and end the task with it unsent.
  const walking = isArchiveWalkActive()
  const indexerURL = await app().settings.getIndexerURL()
  const [copies, ready, archiveScanned, metadataSyncUp, cursor, autoSyncDown] = await Promise.all([
    app().imports.activeCopies(),
    app().imports.pendingFiles(1, Date.now()),
    getPhotosScannedCount(),
    app().localObjects.countSyncUp(indexerURL),
    app().sync.getSyncDownCursor(),
    app().settings.getAutoSyncDownEvents(),
  ])
  const stats = await getFileStatsLocal({ localOnly: true })
  const sync = app().sync.getState()
  return {
    filesRemaining: stats.count,
    bytesRemaining: stats.totalBytes,
    activeUploads: app().uploads.getActiveIds().length,
    importing: copies.files > 0 || ready.length > 0 || walking,
    importBytesCopied: copies.bytesCopied,
    archiveScanned,
    metadataSyncUp,
    syncingDown: sync.isSyncingDown,
    syncDownUnchecked:
      autoSyncDown &&
      app().connection.getState().isConnected &&
      sync.syncDownRuns === syncDownRunsAtStart,
    syncDownCursor: JSON.stringify(cursor ?? null),
  }
}

/**
 * Tracks whether pending work moves forward. A change in what is waiting, in
 * the bytes the uploader has finished, in the bytes import copies have
 * written, in the photos the library walk has looked at, or in sync-down's
 * saved cursor counts. The cursor moves on every
 * batch sync-down commits, where its object count skips events for files not
 * on the device and its progress fraction stays put across events sharing a
 * timestamp. Bytes of uploads in flight count only once they pass the most
 * seen since that last change, so an upload that fails at the same point on
 * every retry does not keep a task awake.
 */
function createProgressTracker(startedAt: number) {
  let lastSettled = ''
  let mostInFlight = 0
  let movedAt = startedAt
  return {
    /** Records a reading and returns how long it has been since work moved forward. */
    sinceProgress(work: PendingWork, now: number): number {
      const settled = JSON.stringify([
        work.filesRemaining,
        work.bytesRemaining,
        work.metadataSyncUp,
        work.importing,
        work.importBytesCopied,
        work.archiveScanned,
        work.syncDownCursor,
        getUploadManager()?.uploadedBytes ?? 0,
      ])
      const inFlight = inFlightUploadBytes()
      if (settled !== lastSettled) {
        lastSettled = settled
        mostInFlight = inFlight
        movedAt = now
      } else if (inFlight > mostInFlight) {
        mostInFlight = inFlight
        movedAt = now
      }
      return now - movedAt
    },
  }
}

/**
 * Bytes sent so far by the active uploads, from each one's progress. A file
 * stays `packing` while its bytes stream to the network, so a large file
 * reports progress for minutes before it reaches `uploading`. A batch keeps
 * adding shard bytes across failed attempts, which can take its progress past
 * 1, so each upload counts at most its size.
 */
function inFlightUploadBytes(): number {
  let bytes = 0
  for (const id of app().uploads.getActiveIds()) {
    const upload = app().uploads.getEntry(id)
    if (upload) bytes += Math.min(upload.progress, 1) * upload.size
  }
  return bytes
}

/** Resolves when `work` settles or `signal` aborts, whichever comes first. */
function untilAborted(work: Promise<unknown>, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
    work.then(done, done)
  })
}

function hasPendingWork(work: PendingWork): boolean {
  return (
    work.filesRemaining > 0 ||
    work.activeUploads > 0 ||
    work.importing ||
    work.metadataSyncUp > 0 ||
    work.syncingDown ||
    work.syncDownUnchecked
  )
}

/**
 * Keeps the app awake for a background task while it has work left, then
 * hands it back to the system. The work itself runs on the app's own service
 * intervals. This function only decides how long to wait for it.
 *
 * The long tasks, the iOS BGProcessingTask and the Android worker, first run a
 * cache eviction pass and then wait on every kind of pending work in
 * [readPendingWork]. The iOS BGAppRefreshTask has 30 seconds and iOS's CPU
 * limit (see bgTaskContext.ts), so it skips eviction and waits on uploads
 * alone. Every task runs the daily orphan scan when it is due, and stops
 * waiting early after `BACKGROUND_TASK_OFFLINE_GRACE` without the indexer,
 * unless an import is copying or ready to copy, or after
 * `BACKGROUND_TASK_STALL_LIMIT` without progress. The refresh task's own
 * deadline comes before either.
 *
 * iOS background task start types:
 * - Warm: App suspended in memory, iOS resumes it - init already complete
 * - Cold: App terminated by system, iOS relaunches - init runs from scratch
 * - Force quit: User swiped up - background tasks won't fire until manual open
 *
 * The two iOS task types can run at once. That is safe because only the
 * processing task runs an eviction pass, the two share one orphan scan, and
 * the rest of the work here only reads.
 */
async function runBackgroundWork(config: TaskConfig, state: TaskState) {
  const log = logTask(config, state)

  const controller = new AbortController()
  state.controller = controller
  const { signal } = controller
  const deadlineMs = softDeadlineMs(config.type)

  // Register with the suspension manager. Ensures the DB is open before
  // we start querying. If the app was suspended, this triggers a resume.
  await registerBackgroundTaskLifecycle(config.id)
  if (signal.aborted) return

  // Check if user has onboarded - if not, there's nothing to do
  const hasOnboarded = await app().settings.getHasOnboarded()
  if (!hasOnboarded) {
    log('skipped', { reason: 'not_onboarded' })
    return
  }
  if (signal.aborted) return

  // Wait for app initialization to complete (handles both warm and cold starts)
  // On warm start, init is already done. On cold start, initApp() runs the full
  // initialization sequence including reconnectIndexer().
  const isInitializing = app().init.getState().isInitializing
  if (isInitializing) {
    log('waiting_for_init')
    const initResult = await waitForInitialization(signal)
    if (initResult === 'timeout') {
      log('skipped', { reason: 'init_timeout' })
      return
    }
    if (initResult === 'aborted') {
      log('skipped', { reason: 'aborted' })
      return
    }
  }

  // Check if initialization failed
  const initError = app().init.getState().initializationError
  if (initError) {
    log('skipped', { reason: 'init_failed', initError })
    return
  }

  const isConnected = app().connection.getState().isConnected
  log('app_ready', { connected: isConnected })

  const longTask = config.type !== 'BGAppRefreshTask'
  // Awaited, so the task cannot finish and let the system suspend the app
  // while a pass is still running. Eviction keeps its hourly gate and the
  // orphan scan its daily one, so a task soon after a pass ran skips it. In
  // the foreground the app runs both on its own schedule. The soft deadline
  // is checked only in the wait loop below, so a timer applies it to the
  // passes as well.
  if (getLifecycle() === 'background') {
    const deadline = setTimeout(
      () => {
        log('soft_deadline_reached', { elapsedMs: Date.now() - state.startTime })
        controller.abort()
      },
      Math.max(0, deadlineMs - (Date.now() - state.startTime)),
    )
    try {
      // Both passes are single-flighted, and a caller that joins a pass
      // someone else started cannot abort it. Resuming a suspended app starts
      // an eviction pass of its own, and the other iOS task may have started
      // the scan. The task stops waiting at its own deadline either way and
      // leaves the pass running.
      if (longTask) await untilAborted(runFsEvictionScanner({ signal }), signal)
      if (!signal.aborted) await untilAborted(runFsOrphanScanner({ signal }), signal)
    } finally {
      clearTimeout(deadline)
    }
    if (signal.aborted) return
  }

  const manager = getUploadManager()!
  const initialStats = await getFileStatsLocal({ localOnly: true })
  const initialSnapshot: UploadSnapshot = {
    packed: manager.packedCount,
    packedBytes: manager.packedBytes,
    uploaded: manager.uploadedCount,
    uploadedBytes: manager.uploadedBytes,
  }
  log('awaiting_upload', {
    count: initialStats.count,
    totalBytes: initialStats.totalBytes,
  })

  let disconnectedSince: number | null = null
  const progress = createProgressTracker(Date.now())
  // The sync-down interval may not tick before the task would otherwise end,
  // so the long tasks ask for a run now and wait for one to finish.
  const syncDownRunsAtStart = app().sync.getState().syncDownRuns
  if (longTask) triggerSyncDownEvents()
  while (!signal.aborted) {
    // TODO: query UIApplication.backgroundTimeRemaining via a native
    // module and self-abort when it dips below the cleanup budget,
    // instead of using a fixed soft deadline. Lets us use whatever
    // the OS is actually willing to give us this invocation.
    if (Date.now() - state.startTime >= deadlineMs) {
      log('soft_deadline_reached', { elapsedMs: Date.now() - state.startTime })
      controller.abort()
      break
    }
    const work = await readPendingWork(longTask, syncDownRunsAtStart)
    if (signal.aborted) break
    log('still_uploading', { ...work, elapsedMs: Date.now() - state.startTime })
    const now = Date.now()
    if (app().connection.getState().isConnected) disconnectedSince = null
    else disconnectedSince ??= now
    // Imports copy from the device and keep going without the indexer.
    const stopReason = !hasPendingWork(work)
      ? 'no work left'
      : !work.importing &&
          disconnectedSince !== null &&
          now - disconnectedSince >= BACKGROUND_TASK_OFFLINE_GRACE
        ? 'offline'
        : progress.sinceProgress(work, now) >= BACKGROUND_TASK_STALL_LIMIT
          ? 'no progress'
          : null
    if (stopReason) {
      const remaining = { count: work.filesRemaining, totalBytes: work.bytesRemaining }
      log(
        'finished',
        buildSummaryData(stopReason, initialStats, remaining, initialSnapshot, manager, state),
      )
      return
    }
    try {
      await delayWithSignal(secondsInMs(10), signal)
    } catch (e) {
      if (isAbortError(e)) break
      throw e
    }
  }

  // Fell out of the loop because the signal aborted (timeout callback).
  const finalStats = await getFileStatsLocal({ localOnly: true }).catch(() => ({
    count: -1,
    totalBytes: -1,
  }))
  log(
    'finished',
    buildSummaryData('aborted', initialStats, finalStats, initialSnapshot, manager, state),
  )
}

type UploadSnapshot = {
  packed: number
  packedBytes: number
  uploaded: number
  uploadedBytes: number
}

function buildSummaryData(
  reason: string,
  initialStats: { count: number; totalBytes: number },
  finalStats: { count: number; totalBytes: number },
  initial: UploadSnapshot,
  manager: {
    packedCount: number
    packedBytes: number
    uploadedCount: number
    uploadedBytes: number
  },
  state: TaskState,
): Record<string, unknown> {
  const filesPacked = manager.packedCount - initial.packed
  const bytesPacked = manager.packedBytes - initial.packedBytes
  const filesUploaded = manager.uploadedCount - initial.uploaded
  const bytesUploaded = manager.uploadedBytes - initial.uploadedBytes
  const filesAdded = finalStats.count - initialStats.count + filesUploaded
  return {
    reason,
    filesPacked,
    bytesPacked,
    filesUploaded,
    bytesUploaded,
    filesAdded,
    filesRemaining: finalStats.count,
    bytesRemaining: finalStats.totalBytes,
    elapsedMs: Date.now() - state.startTime,
  }
}

function logTask(config: TaskConfig, state: TaskState) {
  return (msg: string, data?: Record<string, unknown>) => {
    logger.debug('backgroundTask', msg, {
      taskType: config.type,
      taskId: config.id,
      invocationId: state.invocationId,
      ...data,
    })
  }
}

function transitionTaskState(
  state: TaskState,
  newStatus: 'running' | 'finished',
  config: TaskConfig,
) {
  if (newStatus === 'running') {
    state.startTime = Date.now()
    state.invocationId = Math.random().toString(36).substring(2, 8)
    state.status = 'running'
    setActiveBgTask(config.id, config.type)
  } else if (newStatus === 'finished') {
    state.status = 'finished'
    clearActiveBgTask(config.id)
  }
}
