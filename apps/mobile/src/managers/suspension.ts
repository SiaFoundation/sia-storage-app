import {
  abortAllServiceIntervals,
  pauseAllServiceIntervals,
  resumeAllServiceIntervals,
} from '@siastorage/core/lib/serviceInterval'
import { stopLogForwarder } from '@siastorage/core/services/logForwarder'
import { createSuspensionManager } from '@siastorage/core/services/suspension'
import { logger, stopLogAppender } from '@siastorage/logger'
import { getBackgroundTimeRemainingMs } from 'background-time-remaining'
import { Platform } from 'react-native'
import BackgroundTimer from 'react-native-background-timer'
import RNFS from 'react-native-fs'
import {
  dbInitialized,
  getActiveJournalMode,
  getInflightCount,
  getWalPath,
  interruptDatabase,
  resumeDb,
  suspendDb,
  waitForQueriesIdle,
} from '../db'
import { app } from '../stores/appService'
import { resumeLogger } from '../stores/logs'
import { cancelFsEvictionScanner, runFsEvictionScanner } from './fsEvictionScanner'
import { cancelFsOrphanScanner } from './fsOrphanScanner'
import { addLifecycleListener, getLifecycle } from './lifecycle'
import { isArchiveWalkActive, pauseArchiveSync, resumeArchiveSync } from './syncPhotosArchive'
import { getUploadManager } from './uploader'

/** Logs in-flight subsystem state at suspension start. Useful for diagnosing
 * any future RunningBoard kill from the surrounding log context. */
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
      // Snapshot of iOS's remaining BG time at suspend completion. Proves
      // the native module is wired and returning a sensible value
      // (foreground reads return ~Number.MAX_VALUE, BG reads count down).
      iosBackgroundTimeRemainingMs: getBackgroundTimeRemainingMs(),
    })
  } catch (e) {
    logger.debug('suspension', 'diagnostics_failed', { error: e as Error })
  }
}

const manager = createSuspensionManager(
  {
    scheduler: {
      pause: pauseAllServiceIntervals,
      abort: abortAllServiceIntervals,
      resume: resumeAllServiceIntervals,
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
      interrupt: interruptDatabase,
      getInflightCount,
    },
    platform: {
      getBackgroundTimeRemainingMs,
    },
    hooks: {
      onAfterSuspend: async () => {
        await logSuspendDiagnostics()
        stopLogAppender()
        stopLogForwarder()
        app().downloads.cancelAll()
        cancelFsEvictionScanner()
        cancelFsOrphanScanner()
        pauseArchiveSync()
      },
      onAfterResume: () => {
        resumeLogger()
        void resumeArchiveSync()
        // Eviction's frequency gate short-circuits if it ran recently, so a
        // quick app-switch is cheap; a long suspension triggers a real pass.
        void runFsEvictionScanner()
      },
    },
  },
  { initialAppState: getLifecycle() },
)

let unsubscribeLifecycle: (() => void) | null = null

/**
 * Wraps an async operation with a beginBackgroundTask grant on iOS so the
 * process isn't frozen while the operation is in flight. iOS gives ~30s of
 * additional execution time. Android: no-op (no analog, no kill).
 *
 * IMPORTANT: only safe to call from within the runloop cycle that received
 * applicationDidEnterBackground / didFinishLaunchingWithOptions. Per Apple
 * DTS (forums thread 126438): "The ONLY time it's truly safe to start a
 * background task is in EXACTLY the same runloop cycle as your app was
 * woken by the system. In any other situation … there isn't any way to
 * guarantee that your app hasn't already started to suspend."
 *
 * Do NOT call this inside a BGTask expirationHandler — the await yields
 * the runloop and the beginBackgroundTask request lands too late to be
 * reliably honored. The expirationHandler path uses iOS's natural
 * remaining budget (read via getBackgroundTimeRemainingMs) instead.
 */
async function withIosExecutionTime<T>(fn: () => Promise<T>): Promise<T> {
  if (Platform.OS !== 'ios') return fn()
  await BackgroundTimer.start(0)
  try {
    return await fn()
  } finally {
    BackgroundTimer.stop()
  }
}

export function initSuspensionManager(): void {
  if (unsubscribeLifecycle) return
  const initial = getLifecycle()
  logger.info('appState', 'initial_state', { state: initial })
  logger.info('suspension', 'init', {
    state: initial,
    platform: Platform.OS,
    // Foreground reads return ~Number.MAX_VALUE; logging this once at
    // startup confirms the native binding is wired and callable.
    iosBackgroundTimeRemainingMs: getBackgroundTimeRemainingMs(),
  })
  unsubscribeLifecycle = addLifecycleListener((next, prev) => {
    logger.info('appState', 'state_changed', { from: prev, to: next })
    // Android fires 'background' for picker / share-sheet round-trips
    // that aren't real backgrounding; running the pipeline there degrades
    // the experience. iOS pickers don't background the app, so the flow
    // only fires when the user actually leaves.
    if (Platform.OS !== 'ios') return
    if (next === 'background') {
      if (!dbInitialized) {
        logger.debug('suspension', 'skipped', { reason: 'db_not_initialized' })
        return
      }
      // Init's cleanup steps issue many DB queries; let init finish first.
      if (app().init.getState().isInitializing) {
        logger.debug('suspension', 'skipped', { reason: 'init_in_progress' })
        return
      }
      // The setAppState Promise resolves after the enqueued doSuspend
      // settles; withIosExecutionTime keeps iOS from freezing us mid-drain.
      void withIosExecutionTime(() => manager.setAppState('background'))
    } else {
      void manager.setAppState('foreground')
    }
  })
}

export function teardownSuspensionManager(): void {
  unsubscribeLifecycle?.()
  unsubscribeLifecycle = null
}

/** Called at the start of every BG task — resumes the manager if suspended. */
export function registerBackgroundTaskLifecycle(id: string): Promise<void> {
  return manager.registerBackgroundTask(id)
}

/**
 * Called at the end of every BG task (normal completion + expirationHandler).
 * Suspends if it was the last running task and the app is backgrounded.
 *
 * Intentionally NOT wrapped in withIosExecutionTime — see DTS thread 126438:
 * beginBackgroundTask is only reliably honored in the same runloop cycle as
 * the wake, and the await here yields the runloop. The drain instead caps
 * itself at the iOS budget read via getBackgroundTimeRemainingMs, so the
 * caller's BackgroundFetch.finish() (called AFTER awaiting this) lands
 * inside the BGTask's own expiration grace.
 */
export function releaseBackgroundTaskLifecycle(id: string): Promise<void> {
  return manager.releaseBackgroundTask(id)
}
