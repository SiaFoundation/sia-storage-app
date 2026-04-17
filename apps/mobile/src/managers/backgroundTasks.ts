import { minutesInMs, secondsInMs } from '@siastorage/core'
import { logger } from '@siastorage/logger'
import { AppState, Platform } from 'react-native'
import BackgroundFetch, { type BackgroundFetchConfig } from 'react-native-background-fetch'
import { delayWithSignal, isAbortError } from '../lib/delayWithSignal'
import { app } from '../stores/appService'
import { getFileStatsLocal } from '../stores/files'
import { runFsEvictionScanner } from './fsEvictionScanner'
import { runFsOrphanScanner } from './fsOrphanScanner'
import {
  getIsSuspended,
  registerBackgroundTaskLifecycle,
  releaseBackgroundTaskLifecycle,
} from './suspension'
import { triggerRecentScanIfNeeded } from './syncPhotosArchive'
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
 * Background fetch wakes up the app and runs with the suspended app state.
 * It runs when the following conditions are met:
 * - Unmetered network connection
 * - Battery is not low
 * - The app is NOT fully terminated
 */
const sharedConfig: BackgroundFetchConfig = {
  requiredNetworkType: BackgroundFetch.NETWORK_TYPE_UNMETERED,
  requiresBatteryNotLow: true,
  requiresCharging: false,
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

      transitionTaskState(state, 'running')
      const log = logTask(config, state)
      log('handler_enter', { path: 'normal' })
      try {
        await runBackgroundWork(config, state)
      } catch (error) {
        log('work_error', { error: error as Error })
      } finally {
        transitionTaskState(state, 'finished')
        // Always release — the suspension manager decides whether to
        // actually suspend based on appState and other running tasks.
        try {
          await releaseBackgroundTaskLifecycle(config.id)
        } catch (error) {
          log('release_error', { error: error as Error })
        }
        log('handler_exit', { path: 'normal', didSuspend: getIsSuspended() })
        BackgroundFetch.finish(config.id)
      }
    },
    (taskId: string) => {
      const config = taskConfigs[taskId as TaskId]
      const state = taskStates[taskId as TaskId]
      if (!config || !state) {
        logger.warn('backgroundTask', 'unknown_task_id', { taskId })
        BackgroundFetch.finish(taskId)
        return
      }
      const log = logTask(config, state)
      log('handler_enter', { path: 'timeout' })
      log('timeout')

      // Abort the work loop immediately — signal.aborted is sticky, so
      // any subsequent await-point check inside runBackgroundWork will
      // bail out even if no delayWithSignal is in flight right now.
      state.controller?.abort()
      transitionTaskState(state, 'finished')
      log('timeout_finished', { elapsedMs: Date.now() - state.startTime })

      // iOS's timeout callback is void-returning (library can't await a
      // Promise here), so drive release + finish through a fire-and-
      // forget IIFE. releaseBackgroundTaskLifecycle acquires
      // beginBackgroundTask slack internally, giving the WAL checkpoint
      // + close enough time to complete before iOS freezes the process.
      ;(async () => {
        try {
          await releaseBackgroundTaskLifecycle(config.id)
        } catch (error) {
          log('release_error', { error: error as Error })
        } finally {
          log('handler_exit', { path: 'timeout', didSuspend: getIsSuspended() })
          BackgroundFetch.finish(config.id)
        }
      })()
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

/**
 * Run background work for a given task configuration and state. This function
 * works by simply checking if the resumed app has work to do. If it does, it
 * gives it time to complete. If it doesn't, it will finish the task and return.
 *
 * iOS background task start types:
 * - Warm: App suspended in memory, iOS resumes it - init already complete
 * - Cold: App terminated by system, iOS relaunches - init runs from scratch
 * - Force quit: User swiped up - background tasks won't fire until manual open
 *
 * Note: There is a small chance the two task types will run concurrently,
 * with the current implementation this is fine because both tasks are simply
 * allowing the app to continue already scheduled work. If we ever make the
 * work these tasks more explicit, we may want to take this into account.
 */
async function runBackgroundWork(config: TaskConfig, state: TaskState) {
  const log = logTask(config, state)

  const controller = new AbortController()
  state.controller = controller
  const { signal } = controller

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

  // Skip one-shot scanners if the app is foregrounded — startup already
  // runs these. The upload polling loop below still runs regardless.
  if (AppState.currentState !== 'active') {
    await runFsOrphanScanner()
    if (signal.aborted) return
    await runFsEvictionScanner()
    if (signal.aborted) return
    await triggerRecentScanIfNeeded()
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

  while (!signal.aborted) {
    const stats = await getFileStatsLocal({ localOnly: true })
    if (signal.aborted) break
    log('still_uploading', {
      filesRemaining: stats.count,
      bytesRemaining: stats.totalBytes,
      elapsedMs: Date.now() - state.startTime,
    })
    if (stats.count === 0) {
      log(
        'finished',
        buildSummaryData(
          'all uploaded',
          initialStats,
          { count: 0, totalBytes: 0 },
          initialSnapshot,
          manager,
          state,
        ),
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

function transitionTaskState(state: TaskState, newStatus: 'running' | 'finished') {
  if (newStatus === 'running') {
    state.startTime = Date.now()
    state.invocationId = Math.random().toString(36).substring(2, 8)
    state.status = 'running'
  } else if (newStatus === 'finished') {
    state.status = 'finished'
  }
}
