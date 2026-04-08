import { CoalescingQueue } from '@siastorage/core/lib/coalescingQueue'
import {
  abortAllServiceIntervals,
  pauseAllServiceIntervals,
  resumeAllServiceIntervals,
  waitForAllServiceIntervalsIdle,
} from '@siastorage/core/lib/serviceInterval'
import { logger, stopLogAppender } from '@siastorage/logger'
import { AppState, type AppStateStatus } from 'react-native'
import BackgroundTimer from 'react-native-background-timer'
import { closeDb, dbInitialized, initializeDB } from '../db'
import { resumeLogger } from '../stores/logs'
import { getIsBackgroundTaskRunning } from './backgroundTasks'
import { getUploadManager } from './uploader'

type State = 'active' | 'suspending' | 'suspended' | 'resuming'

// Hard deadline for drain — if services haven't drained by this time,
// close the DB anyway. iOS gives ~30s with beginBackgroundTask; we use
// 25s to leave margin for the close + cleanup.
const HARD_DEADLINE_MS = 25_000

let subscription: ReturnType<typeof AppState.addEventListener> | null = null
let appStateRef: AppStateStatus = AppState.currentState
let state: State = 'active'
const queue = new CoalescingQueue()

export function initSuspensionManager(): void {
  logger.info('suspension', 'init', { state: appStateRef })
  subscription = AppState.addEventListener('change', onAppStateChange)
}

export function teardownSuspensionManager(): void {
  subscription?.remove()
  subscription = null
}

function onAppStateChange(nextState: AppStateStatus): void {
  logger.info('appState', 'state_changed', {
    from: appStateRef,
    to: nextState,
  })
  appStateRef = nextState

  if (nextState === 'background') {
    queue.enqueue(doSuspend)
  } else if (nextState === 'active') {
    queue.enqueue(doResume)
  }
}

async function doSuspend(): Promise<void> {
  if (state !== 'active') {
    logger.debug('suspension', 'skipped', {
      reason: state === 'suspended' ? 'already_suspended' : state,
    })
    return
  }
  if (getIsBackgroundTaskRunning()) {
    logger.debug('suspension', 'skipped', {
      reason: 'background_task_running',
    })
    return
  }
  if (!dbInitialized) {
    logger.debug('suspension', 'skipped', { reason: 'db_not_initialized' })
    return
  }

  state = 'suspending'
  logger.info('suspension', 'starting')

  // Request extra execution time from iOS (~30s) before it suspends
  // the process. On Android this is a no-op.
  await BackgroundTimer.start(0)

  try {
    // Phase 1: Signal all services to stop.
    // pause prevents new ticks, abort signals in-flight workers to exit
    // at their next signal.aborted check.
    pauseAllServiceIntervals()
    abortAllServiceIntervals()
    await getUploadManager()?.suspend()
    logger.debug('suspension', 'services_paused')

    // Phase 2: Wait for in-flight work to finish, with a hard deadline.
    const drainStart = Date.now()
    const drained = await Promise.race([
      waitForAllServiceIntervalsIdle().then(() => true),
      new Promise<false>((r) => setTimeout(() => r(false), HARD_DEADLINE_MS)),
    ])

    if (drained) {
      logger.debug('suspension', 'services_drained', {
        drainMs: Date.now() - drainStart,
      })
    } else {
      logger.warn('suspension', 'hard_deadline_reached', {
        drainMs: Date.now() - drainStart,
      })
    }

    // Phase 3: Close DB to release WAL file lock.
    await stopLogAppender()
    await closeDb()
    state = 'suspended'
  } catch (e) {
    logger.error('suspension', 'suspend_error', { error: e as Error })
    state = 'active'
  } finally {
    BackgroundTimer.stop()
  }
}

async function doResume(): Promise<void> {
  if (state !== 'suspended') {
    getUploadManager()?.adjustBatchForSuspension()
    return
  }

  state = 'resuming'
  logger.info('suspension', 'resuming')

  try {
    await initializeDB({ reopen: true })
  } catch (e) {
    logger.error('suspension', 'resume_error', { error: e as Error })
    state = 'suspended'
    return
  }

  resumeLogger()
  logger.debug('suspension', 'db_reopened')

  const manager = getUploadManager()
  manager?.adjustBatchForSuspension()
  manager?.resume()
  resumeAllServiceIntervals()
  state = 'active'
  logger.info('suspension', 'resumed')
}

export function resumeFromSuspension(): Promise<void> {
  return queue.enqueue(doResume)
}

export function suspendForBackground(): Promise<void> {
  return queue.enqueue(doSuspend)
}

export function getIsSuspended(): boolean {
  return state === 'suspended'
}
