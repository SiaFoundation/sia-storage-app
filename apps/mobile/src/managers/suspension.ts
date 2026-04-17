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
import RNFS from 'react-native-fs'
import {
  closeDb,
  dbInitialized,
  getInflightCount,
  getWalPath,
  initializeDB,
  resumeDb,
  suspendDb,
  waitForQueriesIdle,
} from '../db'
import { setSWREnabled } from '../lib/swr'
import { app } from '../stores/appService'
import { resumeLogger } from '../stores/logs'
import { getIsBackgroundTaskRunning } from './backgroundTasks'
import { isArchiveWalkActive, pauseArchiveSync, resumeArchiveSync } from './syncPhotosArchive'
import { getUploadManager } from './uploader'

/** Snapshot of subsystem state at suspension start. Lets a future 0xdead10cc
 * investigation see at a glance what was in flight — active DB queries,
 * upload-manager state, photo-archive walk activity, and current WAL size.
 * All values are cheap in-memory reads except WAL size (one RNFS.stat call). */
async function logSuspendDiagnostics(): Promise<void> {
  try {
    const walPath = getWalPath()
    const walStat = await RNFS.stat(walPath).catch((e) => {
      logger.warn('suspension', 'wal_stat_failed', { error: e as Error })
      return null
    })
    logger.info('suspension', 'diagnostics', {
      inflightQueries: getInflightCount(),
      uploader: getUploadManager()?.getDiagnostics() ?? null,
      archiveWalkActive: isArchiveWalkActive(),
      walBytes: walStat ? Number(walStat.size) : null,
    })
  } catch (e) {
    logger.debug('suspension', 'diagnostics_failed', { error: e as Error })
  }
}

// Hard deadline for service drain. iOS gives ~30s via beginBackgroundTask
// before freezing the process. Production logs show real drain completes
// in 0–1.4s, so 5s is ~3.5× the observed worst case with plenty of margin.
// The remaining ~25s of the iOS window goes to Phase 4 (drain in-flight
// native SQLite queries) and Phase 5 (WAL checkpoint + close) — which is
// where the fsync-overrun that triggers 0xdead10cc actually happens.
// Android doesn't enforce file-lock checks on suspend, but the sequence
// runs harmlessly there.
const HARD_DEADLINE_MS = 5_000

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
    getDiagnostics: () =>
      getUploadManager()?.getDiagnostics() ?? {
        isSuspended: false,
        batchId: null,
        filesInBatch: 0,
        hasPacker: false,
        finalizing: false,
      },
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
      await logSuspendDiagnostics()
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
