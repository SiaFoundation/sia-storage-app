import AsyncStorage from '@react-native-async-storage/async-storage'
import { getErrorMessage } from '@siastorage/core/lib/errors'
import { shutdownAllServiceIntervals } from '@siastorage/core/lib/serviceInterval'
import { activateSyncGate } from '@siastorage/core/services/syncDownEvents'
import { applyLogContext } from '@siastorage/core/services/logForwarder'
import { stopLogAppender } from '@siastorage/logger'
import { mutate } from 'swr'
import { initializeDB, resetDb, setJournalMode } from '../db'
import { app } from '../stores/appService'
import { resetFileSelection } from '../stores/fileSelection'
import { initLogger } from '../stores/logs'
import { reconnectIndexer, resetSdk } from '../stores/sdk'
import { getUseWalMode, initKeepAwake } from '../stores/settings'
import { resetSheets } from '../stores/sheets'
import { ensureTempFsStorageDirectory } from '../stores/tempFs'
import { resetViewSettings } from '../stores/viewSettings'
import { initBackgroundTasks } from './backgroundTasks'
import { initDbOptimize } from './dbOptimize'
import { runFsEvictionScanner } from './fsEvictionScanner'
import { initImportScanner } from './importScanner'
import { initLogRotation } from './logRotation'
import { initPerfMonitor } from './perfMonitor'
import { initSuspensionManager, teardownSuspensionManager } from './suspension'
import { initSyncDownEvents, triggerSyncDownEvents } from './syncDownEvents'
import { initSyncNewPhotos } from './syncNewPhotos'
import { resetPhotosArchiveCursor } from './syncPhotosArchive'
import { initSyncUpMetadata } from './syncUpMetadata'
import { initThumbnailScanner } from './thumbnailScanner'
import { getUploadManager } from './uploader'

// Change this value to force a one-time app reset on next launch.
// Set to null to disable. Stored via app service settings so each value only triggers once.
const FORCED_RESET_VERSION: string | null = '71936'

export async function initApp(): Promise<void> {
  // Attach the AppState listener first so foreground/background
  // transitions during init are observed. Idempotent; safe to call on
  // re-init from FORCED_RESET / OnboardingFinishedScreen. The suspend
  // flow itself is gated on isInitializing inside onAppStateChange so
  // an early 'background' event during init doesn't race the
  // cleanup/services steps.
  initSuspensionManager()

  // Tag every subsequent log with device + account before any subsystem
  // fires. Reading both here means initApp called after sign-in (e.g., from
  // OnboardingFinishedScreen) lands on the right context instead of wiping
  // the account just-set by refreshLogAccount.
  const [deviceId, mnemonicHash] = await Promise.all([
    app().settings.getDeviceId(),
    app().auth.getMnemonicHash(),
  ])
  applyLogContext(deviceId, mnemonicHash)

  if (FORCED_RESET_VERSION) {
    const completed = await app().settings.getCompletedResetVersion()
    const hasOnboarded = await app().settings.getHasOnboarded()
    if (completed !== FORCED_RESET_VERSION) {
      if (hasOnboarded) {
        await resetApp()
        return
      }
      await app().settings.setCompletedResetVersion(FORCED_RESET_VERSION)
    }
  }

  startInitState()

  const hasOnboarded = await app().settings.getHasOnboarded()

  const steps: StepDefinition[] = [
    {
      id: 'prepare',
      label: 'Starting application',
      message: 'Initializing...',
      runner: async () => {
        await app().fs.ensureStorageDirectory()
        await ensureTempFsStorageDirectory()
        await initKeepAwake()
        const maxDownloads = await app().settings.getMaxDownloads()
        await app().downloads.setMaxSlots(maxDownloads)
        const useWal = await getUseWalMode()
        setJournalMode(useWal ? 'WAL' : 'DELETE')
      },
    },
    {
      id: 'migrations',
      label: 'Initializing database',
      message: 'Updating schema...',
      runner: async (updateDetail) => {
        await initializeDB({
          onProgress: (event) => {
            updateDetail(event.message)
          },
        })
        await app().optimize()
        await initLogger()
      },
    },
  ]

  if (hasOnboarded) {
    steps.push({
      id: 'connect',
      label: 'Sia network',
      message: 'Connecting to the Sia network...',
      runner: async () => {
        await reconnectIndexer()
      },
    })

    steps.push({
      id: 'cleanup',
      label: 'Local storage',
      message: 'Tidying up your cache...',
      runner: async () => {
        await app().files.autoPurgeWithCleanup()
        await runFsEvictionScanner()
      },
    })

    steps.push({
      id: 'services',
      label: 'Starting background services',
      message: 'Launching background services...',
      runner: async () => {
        initDbOptimize()
        await activateSyncGate(app())
        initImportScanner()
        initSyncDownEvents()
        triggerSyncDownEvents()
        initSyncNewPhotos()
        initBackgroundTasks()
        initSyncUpMetadata()
        initThumbnailScanner()
      },
    })
  }

  steps.push({
    id: 'monitoring',
    label: 'Starting monitoring',
    message: 'Launching monitoring...',
    runner: async () => {
      initPerfMonitor()
      await initLogRotation()
    },
  })

  const success = await runSteps(steps)
  if (success) {
    endInitState()
  }
}

async function cancelAllTransfers() {
  const manager = getUploadManager()
  if (manager) await manager.shutdown()
  app().uploads.clear()
  app().downloads.cancelAll()
}

export async function shutdownApp() {
  teardownSuspensionManager()
  await cancelAllTransfers()
}

export async function resetData() {
  await resetDb()
  await app().sync.setSyncDownCursor(undefined)
  await app().sync.setSyncUpCursor(undefined)
  await cancelAllTransfers()
  await app().caches.library.invalidateAll()
  app().caches.libraryVersion.invalidate()
}

// Preserved across both reset paths so log forwarding survives — useful for
// debugging the reset flows themselves. Cursor is intentionally NOT preserved:
// the DB is dropped, so a stale cursor would stall shipping.
const REMOTE_LOG_KEEP_KEYS = ['remoteLogEnabled', 'remoteLogEndpoint', 'deviceId']

// Resync additionally preserves onboarding/indexer so the user stays signed in.
const RESYNC_KEEP_KEYS = [
  'hasOnboarded',
  'indexerURL',
  'completedResetVersion',
  ...REMOTE_LOG_KEEP_KEYS,
]

async function clearAppState({ keepAuth }: { keepAuth: boolean }) {
  // Tear down the SDK first so the rust layer stops retrying uploads against
  // the DB we're about to drop.
  await resetSdk()

  // Cancel uploads and downloads (side-effect cleanup).
  await cancelAllTransfers()

  // Stop the log appender before resetting the DB so it can't write to a
  // replaced connection.
  await stopLogAppender()

  // Drop and recreate all database tables.
  await resetDb()

  // Wipe AsyncStorage except the keep list. The Bearer token lives in
  // SecureStore and is preserved by both paths.
  const keepKeys = keepAuth ? RESYNC_KEEP_KEYS : REMOTE_LOG_KEEP_KEYS
  const allKeys = await AsyncStorage.getAllKeys()
  const toRemove = allKeys.filter((key) => !keepKeys.includes(key))
  if (toRemove.length > 0) {
    await AsyncStorage.multiRemove(toRemove)
  }
  if (!keepAuth) {
    // Sign-out also clears auth identity so the next launch returns to onboarding.
    await app().auth.clearAppKeys()
    await app().auth.clearMnemonicHash()
  }

  // Reset all in-memory state (zustand stores).
  resetAllStores()

  // Reset cursor caches.
  await resetPhotosArchiveCursor()

  // Clear SWR cache last; must come after store resets to avoid races where
  // hooks re-read stale data into a fresh cache.
  await mutate(() => true, undefined, { revalidate: false })
}

export async function resetLocalDataAndResync() {
  await runResetFlow({ label: 'Clearing local data', keepAuth: true })
}

export async function resetLocalDataAndSignOut() {
  await runResetFlow({ label: 'Signing out', keepAuth: false })
}

// Preserved as an alias because initApp's FORCED_RESET_VERSION branch and
// other callers still reference it; sign-out is the historical behavior.
export const resetApp = resetLocalDataAndSignOut

async function runResetFlow({ label, keepAuth }: { label: string; keepAuth: boolean }) {
  // Show splash immediately so the UI stops rendering data we're about to wipe.
  startInitState()

  // Stop service intervals and wait for in-flight workers to finish before
  // tearing down the SDK and DB.
  await shutdownAllServiceIntervals()

  const success = await runSteps([
    {
      id: 'reset',
      label,
      message: 'Clearing data...',
      runner: () => clearAppState({ keepAuth }),
    },
  ])

  if (!success) {
    return
  }

  // Mark the forced reset complete only on success so a failed reset retries
  // on next launch.
  if (FORCED_RESET_VERSION) {
    await app().settings.setCompletedResetVersion(FORCED_RESET_VERSION)
  }

  // Re-initialize the app from clean state.
  await initApp()
}

function resetAllStores() {
  app().connection.setState({
    isConnected: false,
    connectionError: null,
    isAuthing: false,
    isReconnecting: false,
  })
  app().sync.setState({
    isSyncingDown: false,
    syncDownCount: 0,
    syncDownProgress: 0,
    isSyncingUp: false,
    syncUpProcessed: 0,
    syncUpTotal: 0,
    syncGateStatus: 'idle',
  })
  app().uploads.clear()
  app().downloads.cancelAll()
  resetFileSelection()
  resetSheets()
  resetViewSettings()
  app().caches.libraryVersion.invalidate()
}

function startInitState(): void {
  app().init.setState({
    steps: {},
    isInitializing: true,
    initializationError: null,
  })
}

function endInitState(): void {
  app().init.setState({
    steps: {},
    isInitializing: false,
    initializationError: null,
  })
}

type StepDefinition = {
  id: string
  label: string
  message: string
  runner: (updateMessage: (message: string) => void) => Promise<void>
}

async function runSteps(steps: StepDefinition[]): Promise<boolean> {
  for (const stepDef of steps) {
    app().init.setStep({
      id: stepDef.id,
      label: stepDef.label,
      message: stepDef.message,
      startedAt: Date.now(),
    })

    const updateMessage = (message: string) => {
      const prev = app().init.getState().steps[stepDef.id]
      app().init.setStep({
        id: stepDef.id,
        label: stepDef.label,
        message,
        startedAt: prev?.startedAt ?? Date.now(),
      })
    }

    try {
      await stepDef.runner(updateMessage)
    } catch (error) {
      const message = getErrorMessage(error)
      updateMessage(message)
      app().init.setState({ initializationError: message })
      return false
    }
  }
  return true
}
