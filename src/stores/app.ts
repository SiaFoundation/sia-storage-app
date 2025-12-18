import { create } from 'zustand'
import { createGetterAndSelector } from '../lib/selectors'
import { deleteAllFileRecords } from './files'
import { getHasOnboarded, setHasOnboarded } from './settings'
import { reconnectIndexer, resetSdk } from './sdk'
import { initUploadScanner } from '../managers/uploadScanner'
import { cancelAllUploads } from './uploads'
import { cancelAllDownloads } from './downloads'
import { initLogger } from './logs'
import { ensureFsStorageDirectory } from './fs'
import { ensureTempFsStorageDirectory } from './tempFs'
import { initializeDB, resetDb } from '../db'
import {
  initSyncDownEvents,
  resetSyncDownCursor,
} from '../managers/syncDownEvents'
import {
  initSyncNewPhotos,
  resetPhotosNewCursor,
} from '../managers/syncNewPhotos'
import {
  initSyncPhotosArchive,
  resetPhotosArchiveCursor,
} from '../managers/syncPhotosArchive'
import { initBackgroundTasks } from '../managers/backgroundTasks'
import { initSyncUpMetadata } from '../managers/syncUpMetadata'
import { initThumbnailScanner } from '../managers/thumbnailScanner'
import { initFsOrphanScanner } from '../managers/fsOrphanScanner'
import { initFsEvictionScanner } from '../managers/fsEvictionScanner'
import { shutdownAllServiceIntervals } from '../lib/serviceInterval'
import { clearAppKeys } from './appKey'
import { clearMnemonicHash } from './mnemonic'

export type InitStep = {
  id: string
  label: string
  message: string
  startedAt: number
}

type AppInitState = {
  steps: Map<string, InitStep>
  isInitializing: boolean
  initializationError: string | null
}

const useAppInitStore = create<AppInitState>(() => {
  return {
    steps: new Map<string, InitStep>(),
    isInitializing: true,
    initializationError: null,
  }
})

const { setState } = useAppInitStore

export async function initApp(): Promise<void> {
  startInitState()

  const hasOnboarded = await getHasOnboarded()

  const steps: StepDefinition[] = [
    {
      id: 'prepare',
      label: 'Starting application',
      message: 'Initializing...',
      runner: async () => {
        await initLogger()
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
      initUploadScanner()
      initSyncDownEvents()
      initSyncNewPhotos()
      initSyncPhotosArchive()
      initBackgroundTasks()
      initSyncUpMetadata()
      initThumbnailScanner()
      initFsOrphanScanner()
      initFsEvictionScanner()
    },
  })

  await runSteps(steps)

  endInitState()
}

function cancelAllTransfers() {
  cancelAllUploads()
  cancelAllDownloads()
}

export function shutdownApp() {
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
      },
    },
  ])

  await initApp()
}

// selectors

export const [getInitSteps, useInitSteps] = createGetterAndSelector(
  useAppInitStore,
  (state) => {
    const steps = Array.from(state.steps.values())
    return steps.sort((a, b) => a.startedAt - b.startedAt)
  }
)

export const [getCurrentInitStep, useCurrentInitStep] = createGetterAndSelector(
  useAppInitStore,
  (state) => {
    const steps = Array.from(state.steps.values())
    return steps.sort((a, b) => a.startedAt - b.startedAt).at(-1)
  }
)

export const [getInitializationError, useInitializationError] =
  createGetterAndSelector(useAppInitStore, (state) => state.initializationError)

export const [getIsInitializing, useIsInitializing] = createGetterAndSelector(
  useAppInitStore,
  (s) => s.isInitializing
)

export const [getShowSplash, useShowSplash] = createGetterAndSelector(
  useAppInitStore,
  (s) => s.isInitializing || s.initializationError
)

// helpers

function startInitState(): void {
  setState({
    steps: new Map<string, InitStep>(),
    isInitializing: true,
    initializationError: null,
  })
}

function endInitState(): void {
  setState({
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
  setState((state) => {
    const newSteps = new Map(state.steps)
    newSteps.set(step.id, nextStep)
    return { steps: newSteps }
  })
}

function updateInitStep(step: { id: string; message?: string }): void {
  setState((state) => {
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
      setState((state) => ({ ...state, initializationError: message }))
      return // Stop execution on error
    }
  }
}
