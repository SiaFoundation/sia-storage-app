import {
  abortAllServiceIntervals,
  pauseAllServiceIntervals,
  resumeAllServiceIntervals,
  waitForAllServiceIntervalsIdle,
} from '@siastorage/core/lib/serviceInterval'
import { stopLogForwarder } from '@siastorage/core/services/logForwarder'
import { createSuspensionManager } from '@siastorage/core/services/suspension'
import { logger, stopLogAppender } from '@siastorage/logger'
import { AppState, type AppStateStatus, Platform } from 'react-native'
import BackgroundTimer from 'react-native-background-timer'
import RNFS from 'react-native-fs'
import {
  closeDb,
  dbInitialized,
  getActiveJournalMode,
  getInflightCount,
  getWalPath,
  initializeDB,
  resumeDb,
  suspendDb,
  waitForQueriesIdle,
} from '../db'
import { app } from '../stores/appService'
import { resumeLogger } from '../stores/logs'
import { cancelFsEvictionScanner, runFsEvictionScanner } from './fsEvictionScanner'
import { cancelFsOrphanScanner } from './fsOrphanScanner'
import { isArchiveWalkActive, pauseArchiveSync, resumeArchiveSync } from './syncPhotosArchive'
import { getUploadManager } from './uploader'

/** Snapshot of subsystem state at suspension start. Lets a future 0xdead10cc
 * investigation see at a glance what was in flight — active DB queries,
 * upload-manager state, photo-archive walk activity, and current WAL size.
 * All values are cheap in-memory reads except WAL size (one RNFS.stat call). */
async function logSuspendDiagnostics(): Promise<void> {
  try {
    // Only stat the WAL file when it can exist; in DELETE journal mode
    // there's no -wal sidecar and the stat would log a spurious warning.
    const walStat =
      getActiveJournalMode() === 'WAL'
        ? await RNFS.stat(getWalPath()).catch((e) => {
            logger.warn('suspension', 'wal_stat_failed', { error: e as Error })
            return null
          })
        : null
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

// Hard deadline for Phase 2 service drain. Roughly the scale we expect
// service drain to take — observed timings are well under 2s in normal
// runs. Not sized against any iOS API budget: grace from
// applicationDidEnterBackground is short, and beginBackgroundTask's
// extended grant is discretionary and cannot extend a BGTask from
// inside its expirationHandler (Apple DTS forum thread 126438).
// Android doesn't enforce file-lock checks on suspend, but the
// sequence runs harmlessly there.
const HARD_DEADLINE_MS = 1_500

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
      // Non-blocking; awaiting the flush stalls suspend past iOS's
      // BG-task budget. See stopLogAppender JSDoc.
      stopLogAppender()
      stopLogForwarder()
      // Cancel in-flight downloads (disk I/O contention with SQLite fsync
      // is a known 0xdead10cc trigger) and pause the photo-archive walk
      // (an independent loop not driven by the service scheduler, so it
      // keeps issuing catalogAssets writes otherwise).
      app().downloads.cancelAll()
      cancelFsEvictionScanner()
      cancelFsOrphanScanner()
      pauseArchiveSync()
    },
    onAfterResume: () => {
      resumeLogger()
      // Resume archive walk from the same cursor if it wasn't complete.
      void resumeArchiveSync()
      // Eviction's frequency gate short-circuits when it ran recently, so a
      // quick app-switch is cheap; a long suspension triggers a real pass.
      void runFsEvictionScanner()
    },
  },
  hardDeadlineMs: HARD_DEADLINE_MS,
})

let subscription: ReturnType<typeof AppState.addEventListener> | null = null
let appStateRef: AppStateStatus = AppState.currentState

export function initSuspensionManager(): void {
  if (subscription) return
  logger.info('appState', 'initial_state', { state: appStateRef })
  logger.info('suspension', 'init', { state: appStateRef, platform: Platform.OS })
  subscription = AppState.addEventListener('change', (nextState) => {
    logger.info('appState', 'state_changed', { from: appStateRef, to: nextState })
    appStateRef = nextState
    // The suspend/close flow exists for iOS 0xdead10cc protection (mach
    // exception when iOS freezes the process while the SQLite WAL lock
    // is held). Android has no analog, and on Android many things that
    // aren't really "backgrounding" — opening image/document pickers,
    // share sheets — still fire AppState 'background'. Running the full
    // flow on every picker round-trip degrades the experience: cancels
    // in-flight downloads, closes and reopens the DB, re-runs migration
    // checks, pauses all services. iOS pickers don't background the app,
    // so the flow only fires when the user actually leaves.
    if (Platform.OS === 'ios') {
      onAppStateChange(nextState)
    }
  })
}

export function teardownSuspensionManager(): void {
  subscription?.remove()
  subscription = null
}

/**
 * Wrap an async operation with an iOS beginBackgroundTask assertion.
 * Best-effort only: the assertion is granted at iOS's discretion and
 * does NOT extend a BGTask from inside its expirationHandler (Apple
 * DTS forum thread 126438). Cleanup is sized to fit inside the
 * BGTask's wake window (see softDeadlineMs in backgroundTasks.ts)
 * instead of relying on this. Android no-op.
 */
async function withIosExecutionTime<T>(fn: () => Promise<T>): Promise<T> {
  await BackgroundTimer.start(0)
  try {
    return await fn()
  } finally {
    BackgroundTimer.stop()
  }
}

function onAppStateChange(nextState: AppStateStatus): void {
  if (nextState === 'background') {
    if (!dbInitialized) {
      logger.debug('suspension', 'skipped', { reason: 'db_not_initialized' })
      return
    }
    // Init's cleanup/services steps issue many DB queries; running the
    // suspend gate concurrently with them races the close against
    // in-flight queries. Defer until init completes — iOS may suspend
    // us "naturally" without our cleanup, same as before this listener
    // attached early.
    if (app().init.getState().isInitializing) {
      logger.debug('suspension', 'skipped', { reason: 'init_in_progress' })
      return
    }
    // Fire-and-forget; errors surface via the manager's own logging.
    // The setAppState Promise resolves after any enqueued doSuspend
    // settles, so BackgroundTimer keeps iOS from freezing the process
    // until WAL checkpoint + close complete.
    void withIosExecutionTime(() => manager.setAppState('background'))
  } else if (nextState === 'active') {
    // Always safe — setAppState('foreground') enqueues doResume which
    // is a no-op when state !== 'suspended'.
    void manager.setAppState('foreground')
  }
}

/**
 * Called by backgroundTasks.ts at the start of every BG task invocation.
 * Registers the task with the suspension manager and returns once the
 * DB is open (reopen happens inside the manager's queue if needed).
 */
export function registerBackgroundTaskLifecycle(id: string): Promise<void> {
  return manager.registerBackgroundTask(id)
}

/**
 * Called by backgroundTasks.ts at the end of every BG task invocation,
 * including the timeout path. If this is the last running BG task and
 * the app is in background, triggers a suspend. Wrapped with
 * beginBackgroundTask to keep iOS from freezing the process during the
 * WAL checkpoint and close.
 */
export function releaseBackgroundTaskLifecycle(id: string): Promise<void> {
  return withIosExecutionTime(() => manager.releaseBackgroundTask(id))
}

export function getIsSuspended(): boolean {
  return manager.isSuspended()
}
