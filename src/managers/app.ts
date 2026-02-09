import { mutate } from 'swr'
import { initializeDB, resetDb } from '../db'
import { shutdownAllServiceIntervals } from '../lib/serviceInterval'
import { type InitStep, setAppState } from '../stores/app'
import { clearAppKeys } from '../stores/appKey'
import { cancelAllDownloads } from '../stores/downloads'
import { deleteAllFileRecords } from '../stores/files'
import { ensureFsStorageDirectory } from '../stores/fs'
import { initLogger } from '../stores/logs'
import { clearMnemonicHash } from '../stores/mnemonic'
import { reconnectIndexer, resetSdk } from '../stores/sdk'
import { getHasOnboarded, setHasOnboarded } from '../stores/settings'
import { ensureTempFsStorageDirectory } from '../stores/tempFs'
import { clearAllUploads } from '../stores/uploads'
import { initBackgroundTasks } from './backgroundTasks'
import { initFsEvictionScanner } from './fsEvictionScanner'
import { initFsOrphanScanner } from './fsOrphanScanner'
import { initLogRotation } from './logRotation'
import { initSyncDownEvents, resetSyncDownCursor } from './syncDownEvents'
import { initSyncNewPhotos, resetPhotosNewCursor } from './syncNewPhotos'
import {
  initSyncPhotosArchive,
  resetPhotosArchiveCursor,
} from './syncPhotosArchive'
import { initSyncUpMetadata } from './syncUpMetadata'
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
  }

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
      initFsOrphanScanner()
      initFsEvictionScanner()
      await initLogRotation()
    },
  })

  await runSteps(steps)

  endInitState()
}

function cancelAllTransfers() {
  getUploadManager().shutdown()
  clearAllUploads()
  cancelAllDownloads()
}

export async function shutdownApp() {
  cancelAllTransfers()
}

export async function resetData() {
  await deleteAllFileRecords()
  await resetDb()
  await resetSyncDownCursor()
  cancelAllTransfers()
}

export async function resetApp() {
  startInitState()
  shutdownAllServiceIntervals()

  await runSteps([
    {
      id: 'reset',
      label: 'Resetting application',
      message: 'Clearing data...',
      runner: async () => {
        await resetData()
        await clearAppKeys()
        await clearMnemonicHash()
        await setHasOnboarded(false)
        await resetSdk()
        await resetPhotosNewCursor()
        await resetPhotosArchiveCursor()
        await mutate(() => true, undefined, { revalidate: false })
      },
    },
  ])

  await initApp()
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

async function runSteps(steps: StepDefinition[]): Promise<void> {
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
      return // Stop execution on error
    }
  }
}
