import AsyncStorage from '@react-native-async-storage/async-storage'
import { shutdownAllServiceIntervals } from '@siastorage/core/lib/serviceInterval'
import { mutate } from 'swr'
import { initializeDB, resetDb } from '../db'
import { autoPurgeOldTrashedFiles } from '../lib/deleteFile'
import { app } from '../stores/appService'
import { resetFileSelection } from '../stores/fileSelection'
import { initLogger } from '../stores/logs'
import { reconnectIndexer, resetSdk } from '../stores/sdk'
import { initKeepAwake } from '../stores/settings'
import { resetSheets } from '../stores/sheets'
import { ensureTempFsStorageDirectory } from '../stores/tempFs'
import { resetViewSettings } from '../stores/viewSettings'
import { initBackgroundTasks } from './backgroundTasks'
import { initDbOptimize } from './dbOptimize'
import { runFsEvictionScanner } from './fsEvictionScanner'
import { runFsOrphanScanner } from './fsOrphanScanner'
import { initImportScanner } from './importScanner'
import { initLogRotation } from './logRotation'
import { initPerfMonitor } from './perfMonitor'
import { initSyncDownEvents } from './syncDownEvents'
import { initSyncNewPhotos } from './syncNewPhotos'
import { resetPhotosArchiveCursor } from './syncPhotosArchive'
import { initSyncUpMetadata } from './syncUpMetadata'
import { initThumbnailScanner } from './thumbnailScanner'
import { getUploadManager } from './uploader'

// Change this value to force a one-time app reset on next launch.
// Set to null to disable. Stored via app service settings so each value only triggers once.
const FORCED_RESET_VERSION: string | null = '40582'

export async function initApp(): Promise<void> {
  if (FORCED_RESET_VERSION) {
    const completed = await app().settings.getCompletedResetVersion()
    const hasOnboarded = await app().settings.getHasOnboarded()
    if (completed !== FORCED_RESET_VERSION && hasOnboarded) {
      await resetApp()
      return
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
        await initLogger()
        await app().optimize()
      },
    },
  ]

  if (hasOnboarded) {
    steps.push({
      id: 'connect',
      label: 'Connecting to indexer',
      message: 'Initializing SDK...',
      runner: async () => {
        await reconnectIndexer()
      },
    })

    steps.push({
      id: 'cleanup',
      label: 'Cleaning up old files',
      message: 'Cleaning up old files...',
      runner: async (updateMessage) => {
        await autoPurgeOldTrashedFiles()
        await runFsOrphanScanner({
          onProgress: (removed) => {
            updateMessage(`Cleaning up old files... ${removed} removed`)
          },
        })
        await runFsEvictionScanner()
      },
    })

    steps.push({
      id: 'services',
      label: 'Starting background services',
      message: 'Launching background services...',
      runner: async () => {
        initDbOptimize()
        initImportScanner()
        initSyncDownEvents()
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

export async function resetApp() {
  // 1. Show splash screen immediately.
  startInitState()

  // 2. Stop all service intervals and wait for in-flight workers to finish.
  await shutdownAllServiceIntervals()

  const success = await runSteps([
    {
      id: 'reset',
      label: 'Resetting application',
      message: 'Clearing data...',
      runner: async () => {
        // 3. Tear down SDK to stop the rust layer from retrying uploads.
        await resetSdk()

        // 4. Cancel uploads and downloads (side-effect cleanup).
        await cancelAllTransfers()

        // 5. Drop and recreate all database tables.
        await resetDb()

        // 5. Wipe all persisted state.
        await AsyncStorage.clear()
        await app().auth.clearAppKeys()
        await app().auth.clearMnemonicHash()

        // 6. Reset all in-memory state (zustand stores).
        resetAllStores()

        // 7. Reset cursor caches.
        await resetPhotosArchiveCursor()

        // 8. Clear SWR cache (must come after store resets to avoid races).
        await mutate(() => true, undefined, { revalidate: false })
      },
    },
  ])

  if (!success) {
    return
  }

  // 9. Mark forced reset as completed so it doesn't re-trigger.
  // Saved after success so failed resets retry on next launch.
  if (FORCED_RESET_VERSION) {
    await app().settings.setCompletedResetVersion(FORCED_RESET_VERSION)
  }

  // 10. Re-initialize the app from clean state.
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
    syncDownExisting: 0,
    syncDownAdded: 0,
    syncDownDeleted: 0,
    isSyncingUp: false,
    syncUpProcessed: 0,
    syncUpTotal: 0,
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
      const message = error instanceof Error ? error.message : String(error)
      updateMessage(message)
      app().init.setState({ initializationError: message })
      return false
    }
  }
  return true
}
