import AsyncStorage from '@react-native-async-storage/async-storage'
import { shutdownAllServiceIntervals } from '@siastorage/core/lib/serviceInterval'
import { mutate } from 'swr'
import { initializeDB, resetDb } from '../db'
import { type InitStep, setAppState } from '../stores/app'
import { clearAppKeys } from '../stores/appKey'
import { useAuthWebViewStore } from '../stores/authWebView'
import { cancelAllDownloads, useDownloadsStore } from '../stores/downloads'
import { useFileSelectionStore } from '../stores/fileSelection'
import { ensureFsStorageDirectory } from '../stores/fs'
import { invalidateCacheLibraryLists } from '../stores/librarySwr'
import { initLogger } from '../stores/logs'
import { clearMnemonicHash } from '../stores/mnemonic'
import { reconnectIndexer, useSdkStore } from '../stores/sdk'
import { getHasOnboarded } from '../stores/settings'
import { useSheetsStore } from '../stores/sheets'
import { useSyncDownStore } from '../stores/syncDown'
import { useSyncUpMetadataStore } from '../stores/syncUpMetadata'
import { ensureTempFsStorageDirectory } from '../stores/tempFs'
import { clearAllUploads, useUploadsStore } from '../stores/uploads'
import { resetViewSettings } from '../stores/viewSettings'
import { initBackgroundTasks } from './backgroundTasks'
import { runFsEvictionScanner } from './fsEvictionScanner'
import { runFsOrphanScanner } from './fsOrphanScanner'
import { initLogRotation } from './logRotation'
import { initPerfMonitor } from './perfMonitor'
import { initSyncDownEvents, resetSyncDownCursor } from './syncDownEvents'
import { initSyncNewPhotos } from './syncNewPhotos'
import {
  initSyncPhotosArchive,
  resetPhotosArchiveCursor,
} from './syncPhotosArchive'
import { initSyncUpMetadata, resetSyncUpCursor } from './syncUpMetadata'
import { initThumbnailScanner } from './thumbnailScanner'
import { getUploadManager } from './uploader'

export async function initApp(): Promise<void> {
  startInitState()

  const hasOnboarded = await getHasOnboarded()

  const steps: StepDefinition[] = [
    {
      id: 'prepare',
      label: 'Starting application',
      message: 'Initializing...',
      runner: async () => {
        ensureFsStorageDirectory()
        ensureTempFsStorageDirectory()
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
      },
    },
  ]

  if (hasOnboarded) {
    steps.push({
      id: 'connect',
      label: 'Connecting to indexer',
      message: 'Initializing SDK...',
      runner: async () => {
        const connected = await reconnectIndexer()
        if (!connected) {
          throw new Error('Failed to connect to indexer.')
        }
      },
    })

    steps.push({
      id: 'cleanup',
      label: 'Cleaning up old files',
      message: 'Cleaning up old files...',
      runner: async (updateMessage) => {
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
        initSyncDownEvents()
        initSyncNewPhotos()
        initSyncPhotosArchive()
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
  await getUploadManager().shutdown()
  clearAllUploads()
  cancelAllDownloads()
}

export async function shutdownApp() {
  await cancelAllTransfers()
}

export async function resetData() {
  await resetDb()
  await resetSyncDownCursor()
  await resetSyncUpCursor()
  await cancelAllTransfers()
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
        // 3. Cancel uploads and downloads (side-effect cleanup).
        await cancelAllTransfers()

        // 4. Drop and recreate all database tables.
        await resetDb()

        // 5. Wipe all persisted state.
        await AsyncStorage.clear()
        await clearAppKeys()
        await clearMnemonicHash()

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

  // 9. Re-initialize the app from clean state.
  await initApp()
}

function resetAllStores() {
  useSdkStore.setState({
    sdk: null,
    isConnected: false,
    connectionError: null,
    isAuthing: false,
    isReconnecting: false,
    pendingApproval: null,
  })
  useSyncDownStore.setState({ isSyncing: false })
  useSyncUpMetadataStore.setState({ isSyncing: false, processed: 0, total: 0 })
  useUploadsStore.setState({ uploads: {} })
  useDownloadsStore.setState({ downloads: {} })
  useFileSelectionStore.setState({
    selectedFileIds: new Set(),
    isSelectionMode: false,
  })
  useSheetsStore.setState({ openName: '' })
  useAuthWebViewStore.setState({ visible: false, url: '', resolver: null })
  resetViewSettings()
  invalidateCacheLibraryLists()
}

function startInitState(): void {
  setAppState({
    steps: new Map<string, InitStep>(),
    isInitializing: true,
    initializationError: null,
  })
}

function endInitState(): void {
  setAppState({
    steps: new Map<string, InitStep>(),
    isInitializing: false,
    initializationError: null,
  })
}

function nextInitStep(step: Omit<InitStep, 'startedAt'>): void {
  const nextStep = {
    ...step,
    startedAt: Date.now(),
  }
  setAppState((state) => {
    const newSteps = new Map(state.steps)
    newSteps.set(step.id, nextStep)
    return { steps: newSteps }
  })
}

function updateInitStep(step: { id: string; message?: string }): void {
  setAppState((state) => {
    const prev = state.steps.get(step.id)
    if (!prev) return state
    const next: InitStep = {
      ...prev,
      ...step,
    }
    const newSteps = new Map(state.steps)
    newSteps.set(step.id, next)
    return { steps: newSteps }
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
    nextInitStep({
      id: stepDef.id,
      label: stepDef.label,
      message: stepDef.message,
    })

    const updateMessage = (message: string) => {
      updateInitStep({
        id: stepDef.id,
        message,
      })
    }

    try {
      await stepDef.runner(updateMessage)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      updateMessage(message)
      setAppState((state) => ({ ...state, initializationError: message }))
      return false
    }
  }
  return true
}
