import {
  abortAllServiceIntervals,
  pauseAllServiceIntervals,
  resumeAllServiceIntervals,
} from '@siastorage/core/lib/serviceInterval'
import { stopLogForwarder } from '@siastorage/core/services/logForwarder'
import { createSuspensionManager } from '@siastorage/core/services/suspension'
import { logger, stopLogAppender } from '@siastorage/logger'
import { AppState, type AppStateStatus, Platform } from 'react-native'
import RNFS from 'react-native-fs'
import { dbInitialized, getActiveJournalMode, getInflightCount, getWalPath } from '../db'
import { app } from '../stores/appService'
import { resumeLogger } from '../stores/logs'
import { cancelFsEvictionScanner, runFsEvictionScanner } from './fsEvictionScanner'
import { cancelFsOrphanScanner } from './fsOrphanScanner'
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
    })
  } catch (e) {
    logger.debug('suspension', 'diagnostics_failed', { error: e as Error })
  }
}

const manager = createSuspensionManager({
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
  hooks: {
    // Battery hygiene: stop the CPU/network work that was about to be
    // frozen anyway. All synchronous / fire-and-forget — we don't need
    // confirmation, just signal stop.
    onBeforeSuspend: async () => {
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
    // Android fires 'background' for picker / share-sheet round-trips
    // that aren't real backgrounding; running the pipeline there degrades
    // the experience. iOS pickers don't background the app, so the flow
    // only fires when the user actually leaves.
    if (Platform.OS === 'ios') {
      onAppStateChange(nextState)
    }
  })
}

export function teardownSuspensionManager(): void {
  subscription?.remove()
  subscription = null
}

function onAppStateChange(nextState: AppStateStatus): void {
  if (nextState === 'background') {
    if (!dbInitialized) {
      logger.debug('suspension', 'skipped', { reason: 'db_not_initialized' })
      return
    }
    // Init's cleanup steps issue many DB queries; let init finish first.
    if (app().init.getState().isInitializing) {
      logger.debug('suspension', 'skipped', { reason: 'init_in_progress' })
      return
    }
    void manager.setAppState('background')
  } else if (nextState === 'active') {
    void manager.setAppState('foreground')
  }
}

/** Called at the start of every BG task — resumes the manager if suspended. */
export function registerBackgroundTaskLifecycle(id: string): Promise<void> {
  return manager.registerBackgroundTask(id)
}

/**
 * Called at the end of every BG task (normal completion + expirationHandler).
 * Suspends if it was the last running task and the app is backgrounded.
 *
 * Callers MUST have already called `BackgroundFetch.finish()` (or the
 * equivalent platform release) before invoking this. iOS kills with
 * 0xDEAD10CC if the BG-task assertion is held past the 5s expiration
 * warning, and this lifecycle release does not satisfy that contract.
 */
export function releaseBackgroundTaskLifecycle(id: string): Promise<void> {
  return manager.releaseBackgroundTask(id)
}
