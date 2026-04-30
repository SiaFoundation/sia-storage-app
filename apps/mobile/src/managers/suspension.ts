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
import { mutate as swrGlobalMutate } from 'swr'
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
      // Drain JS log buffer to DB before halting the HTTP ticker;
      // stopLogForwarder awaits any in-flight ship so its cursor
      // UPDATE doesn't race the DB close.
      await stopLogAppender()
      await stopLogForwarder()
      setSWREnabled(false)
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
      // SWR re-enable lives in onForegroundActive, not here — onAfterResume
      // also fires on BG-task wakes (AppState stays 'background'), where
      // we want SWR to stay off.
      resumeLogger()
      // Resume archive walk from the same cursor if it wasn't complete.
      void resumeArchiveSync()
      // Eviction's frequency gate short-circuits when it ran recently, so a
      // quick app-switch is cheap; a long suspension triggers a real pass.
      void runFsEvictionScanner()
    },
    onForegroundActive: () => {
      // iOS-only path. The mobile AppState listener routes 'active'
      // through manager.setAppState('foreground') which fires this hook;
      // the Android branch in initSuspensionManager calls the helper
      // directly because Android skips the manager's suspend flow.
      reEnableSWROnForeground()
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
    } else if (nextState === 'active') {
      // Android skips the manager's suspend flow because AppState
      // 'background' fires for picker / share-sheet round-trips that
      // aren't real backgrounding. Call the helper directly instead of
      // routing through the manager hook.
      reEnableSWROnForeground()
    }
  })
}

/** Flips SWR back on and forces revalidation of every subscribed hook.
 * Two callers: the iOS path via the manager's onForegroundActive hook
 * (integration-test covered) and the Android branch above (direct).
 * The mutate is necessary because SWR's isPaused gates revalidation
 * events but doesn't trigger them when the flag flips back — hooks that
 * mounted against a paused SWR stay frozen until something kicks them.
 * Covers the iOS deep-link case where a screen mounts during the resume
 * race before SWR un-pauses. */
function reEnableSWROnForeground(): void {
  setSWREnabled(true)
  void swrGlobalMutate(() => true)
  logger.info('suspension', 'swr_enabled')
}

export function teardownSuspensionManager(): void {
  subscription?.remove()
  subscription = null
}

/**
 * Wrap an async operation with an iOS beginBackgroundTask grant so the
 * process isn't suspended while the operation is in flight. iOS gives
 * ~30s of additional execution time. On Android this is a no-op.
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
    // Fire-and-forget; errors surface via the manager's own logging.
    // The setAppState Promise resolves after any enqueued doSuspend
    // settles, so BackgroundTimer keeps iOS from freezing the process
    // until WAL checkpoint + close complete.
    void withIosExecutionTime(() => manager.setAppState('background'))
  } else if (nextState === 'active') {
    // SWR re-enable now lives in the manager's onForegroundActive hook,
    // which fires whenever appState transitions to foreground regardless
    // of the manager's internal resume/suspended state.
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
