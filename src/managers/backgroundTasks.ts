import { logger } from '../lib/logger'
import BackgroundFetch, {
  BackgroundFetchConfig,
} from 'react-native-background-fetch'
import { minutesInMs, secondsInMs } from '../lib/time'
import { Platform } from 'react-native'
import { getFileCountLocal } from '../stores/files'
import { getIsConnected } from '../stores/sdk'
import { hasCachedAppKey } from '../stores/appKey'
import { createBackgroundDelay } from '../lib/backgroundDelay'

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
  abort?: () => void
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
  'com.transistorsoft.fetch': {
    startTime: 0,
    status: 'finished',
    abort: undefined,
  },
  'com.transistorsoft.processing': {
    startTime: 0,
    status: 'finished',
    abort: undefined,
  },
  'react-native-background-fetch': {
    startTime: 0,
    status: 'finished',
    abort: undefined,
  },
}

function createFreshTaskState(): TaskState {
  return {
    startTime: 0,
    status: 'finished',
    abort: undefined,
  }
}

/**
 * Reset a specific task's state, aborting any pending operations.
 */
function resetTaskState(taskId: TaskId) {
  const state = taskStates[taskId]
  // Abort any pending delay from previous invocation
  state.abort?.()
  // Reset to fresh state
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
        logger.warn('backgroundTask', `unknown task id: ${taskId}`)
        BackgroundFetch.finish(taskId)
        return
      }

      // Reset state for this task to ensure fresh start,
      // aborting any lingering operations from previous invocation
      resetTaskState(taskId as TaskId)

      transitionTaskState(state, 'running')
      await runBackgroundWork(config, state)
      transitionTaskState(state, 'finished')
      BackgroundFetch.finish(config.id)
    },
    (taskId: string) => {
      const config = taskConfigs[taskId as TaskId]
      const state = taskStates[taskId as TaskId]
      if (!config || !state) {
        logger.warn('backgroundTask', `unknown task id: ${taskId}`)
        BackgroundFetch.finish(taskId)
        return
      }
      const log = logTask(config)

      log(`timeout callback fired, aborting delay and finishing task`)

      // Abort any pending delay BEFORE setting status, so the while loop
      // can exit cleanly when the Promise resolves.
      state.abort?.()
      transitionTaskState(state, 'finished')
      BackgroundFetch.finish(config.id)
      log(
        `finished, reason: timeout, elapsedTime: ${getElapsedTime(
          state.startTime
        )}`
      )
    }
  )

  logger.info('backgroundTask', `configure status: ${status}`)

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
      logger.info(
        'backgroundTask',
        `scheduleTask status for ${bgProcessingTaskConfig.id}: ${scheduled}`
      )
    } catch (error) {
      logger.error(
        'backgroundTask',
        `scheduleTask failed for ${bgProcessingTaskConfig.id}:`,
        error
      )
    }
  }
}

/**
 * Run background work for a given task configuration and state. This function
 * works by simply checking if the resumed app has work to do. If it does, it
 * gives it time to complete. If it doesn't, it will finish the task and return.
 * Note: There is a small chance the two task types will run concurrently,
 * with the current implementation this is fine because both tasks are simply
 * allowing the app to continue already scheduled work. If we ever make the
 * work these tasks more explicit, we may want to take this into account.
 */
async function runBackgroundWork(config: TaskConfig, state: TaskState) {
  state.startTime = Date.now()
  const log = logTask(config)

  // Create instance-based cancellable delay for this invocation
  const { delay: delayFn, abort } = createBackgroundDelay()
  state.abort = abort

  // Log diagnostic info to distinguish cold start vs resume
  const isConnected = getIsConnected()
  const hasCached = hasCachedAppKey()
  log(
    `starting... (connected=${isConnected}, hasCachedAppKey=${hasCached}, coldStart=${!hasCached})`
  )

  if (!isConnected) {
    log('SDK not connected, uploads will wait for connection...')
  }

  while (true) {
    if (state.status === 'finished') {
      log(
        `task is in finished state, breaking loop, elapsedTime: ${getElapsedTime(
          state.startTime
        )}`
      )
      return
    }
    log(`checking for local only files...`)
    const localCount = await getFileCountLocal({ localOnly: true })
    log(`local only files count: ${localCount}`)
    if (localCount === 0) {
      log(
        `stopping, reason: all files uploaded, elapsedTime: ${getElapsedTime(
          state.startTime
        )}`
      )
      return
    }
    log(`waiting for uploads...`)
    const result = await delayFn(secondsInMs(10))
    if (result === 'aborted') {
      log(`delay aborted, exiting cleanly`)
      return
    }
  }
}

function getElapsedTime(startTime: number) {
  return Date.now() - startTime
}

function logTask(config: TaskConfig) {
  return (message: string) => {
    logger.debug('backgroundTask', `[${config.type}][${config.id}] ${message}`)
  }
}

function transitionTaskState(
  state: TaskState,
  newStatus: 'running' | 'finished'
) {
  if (newStatus === 'running') {
    state.startTime = Date.now()
    state.status = 'running'
  } else if (newStatus === 'finished') {
    state.status = 'finished'
  }
}
