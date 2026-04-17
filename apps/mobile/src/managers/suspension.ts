import {
  abortAllServiceIntervals,
  pauseAllServiceIntervals,
  resumeAllServiceIntervals,
  waitForAllServiceIntervalsIdle,
} from '@siastorage/core/lib/serviceInterval'
import { createSuspensionManager } from '@siastorage/core/services/suspension'
import { logger, stopLogAppender } from '@siastorage/logger'
import { AppState, type AppStateStatus } from 'react-native'
import BackgroundTimer from 'react-native-background-timer'
import {
  closeDb,
  dbInitialized,
  initializeDB,
  resumeDb,
  suspendDb,
  waitForQueriesIdle,
} from '../db'
import { setSWREnabled } from '../lib/swr'
import { app } from '../stores/appService'
import { resumeLogger } from '../stores/logs'
import { getIsBackgroundTaskRunning } from './backgroundTasks'
import { pauseArchiveSync, resumeArchiveSync } from './syncPhotosArchive'
import { getUploadManager } from './uploader'

// Hard deadline for service drain. iOS gives ~30s via beginBackgroundTask
// before freezing the process. The DB stays open during drain so services
// can finish their work, so we keep this conservative to leave margin for
// gate + WAL checkpoint + close. On Android this entire sequence is
// unnecessary (Android's cached apps freezer doesn't enforce file lock
// checks like iOS's 0xdead10cc), but it runs harmlessly.
const HARD_DEADLINE_MS = 15_000

const manager = createSuspensionManager({
  scheduler: {
    pause: pauseAllServiceIntervals,
    abort: abortAllServiceIntervals,
    resume: resumeAllServiceIntervals,
    waitForIdle: waitForAllServiceIntervalsIdle,
  },
  uploader: {
    suspend: () => getUploadManager()?.suspend() ?? Promise.resolve(),
    resume: () => getUploadManager()?.resume(),
    adjustBatchForSuspension: () => getUploadManager()?.adjustBatchForSuspension(),
  },
  db: {
    gate: suspendDb,
    ungate: resumeDb,
    waitForIdle: waitForQueriesIdle,
    close: closeDb,
    reopen: () => initializeDB({ reopen: true }),
  },
  hooks: {
    onBeforeSuspend: async () => {
      await stopLogAppender()
      setSWREnabled(false)
      // Cancel in-flight downloads (disk I/O contention with SQLite fsync
      // is a known 0xdead10cc trigger) and pause the photo-archive walk
      // (an independent loop not driven by the service scheduler, so it
      // keeps issuing catalogAssets writes otherwise).
      app().downloads.cancelAll()
      pauseArchiveSync()
    },
    onAfterResume: () => {
      setSWREnabled(true)
      resumeLogger()
      // Resume archive walk from the same cursor if it wasn't complete.
      void resumeArchiveSync()
    },
  },
  hardDeadlineMs: HARD_DEADLINE_MS,
})

let subscription: ReturnType<typeof AppState.addEventListener> | null = null
let appStateRef: AppStateStatus = AppState.currentState

export function initSuspensionManager(): void {
  if (subscription) return
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
    suspendForBackground()
  } else if (nextState === 'active') {
    resumeFromSuspension()
  }
}

export async function suspendForBackground(): Promise<void> {
  if (getIsBackgroundTaskRunning()) {
    logger.debug('suspension', 'skipped', { reason: 'background_task_running' })
    return
  }
  if (!dbInitialized) {
    logger.debug('suspension', 'skipped', { reason: 'db_not_initialized' })
    return
  }

  // Request extra execution time from iOS (~30s) before it suspends
  // the process. On Android this is a no-op.
  await BackgroundTimer.start(0)
  try {
    await manager.suspend()
  } finally {
    BackgroundTimer.stop()
  }
}

export function resumeFromSuspension(): Promise<void> {
  return manager.resume()
}

export function getIsSuspended(): boolean {
  return manager.isSuspended()
}
