import { serviceLog } from '../lib/logger'
import BackgroundFetch, {
  BackgroundFetchConfig,
} from 'react-native-background-fetch'
import { secondsInMs } from '../lib/time'
import { Platform } from 'react-native'
import { getFileCountLocal } from '../stores/files'
import BackgroundTimer from 'react-native-background-timer'

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
    status: 'running',
  },
  'com.transistorsoft.processing': {
    startTime: 0,
    status: 'running',
  },
  'react-native-background-fetch': {
    startTime: 0,
    status: 'running',
  },
}

export async function initBackgroundTasks() {
  serviceLog(`[backgroundTask] init`)

  const status = await BackgroundFetch.configure(
    {
      minimumFetchInterval: 15,
      ...sharedConfig,
    },
    async (taskId: string) => {
      const config = taskConfigs[taskId as TaskId]
      const state = taskStates[taskId as TaskId]
      if (!config) {
        serviceLog(`[backgroundTask] unknown task id: ${taskId}`)
        BackgroundFetch.finish(taskId)
        return
      }
      transitionTaskState(state, 'running')
      await runBackgroundWork(config, state)
      transitionTaskState(state, 'finished')
      BackgroundFetch.finish(config.id)
    },
    (taskId: string) => {
      const config = taskConfigs[taskId as TaskId]
      const state = taskStates[taskId as TaskId]
      transitionTaskState(state, 'finished')
      if (!config) {
        serviceLog(`[backgroundTask] unknown task id: ${taskId}`)
        BackgroundFetch.finish(taskId)
        return
      }
      BackgroundFetch.finish(taskId)
      logTask(config)(
        `finished, reason: timeout, elapsedTime: ${getElapsedTime(
          state.startTime
        )}`
      )
    }
  )

  serviceLog('[backgroundTask] configure status: ', status)

  // Schedule custom background processing task on iOS.
  if (Platform.OS === 'ios') {
    const bgProcessingTaskConfig = taskConfigs['com.transistorsoft.processing']
    try {
      const scheduled = await BackgroundFetch.scheduleTask({
        taskId: bgProcessingTaskConfig.id,
        periodic: true,
        delay: secondsInMs(5),
        ...sharedConfig,
      })
      serviceLog(
        `[backgroundTask] scheduleTask status for ${bgProcessingTaskConfig.id}: ${scheduled}`
      )
    } catch (error) {
      serviceLog(
        `[backgroundTask] scheduleTask failed for ${bgProcessingTaskConfig.id}:`,
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
  log('starting...')

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
    await delay(secondsInMs(10))
  }
}

function getElapsedTime(startTime: number) {
  return Date.now() - startTime
}

// It appears that setTimeout does not work in background tasks on Android,
// so we use react-native-background-timer instead.
function delay(ms: number) {
  return new Promise((resolve) => {
    BackgroundTimer.setTimeout(() => resolve(true), ms)
  })
}

function logTask(config: TaskConfig) {
  return (message: string) => {
    serviceLog(
      `[${new Date().toISOString()}][${config.type}][${config.id}] ${message}`
    )
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
