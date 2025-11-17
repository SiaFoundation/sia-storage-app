import { create } from 'zustand'
import { createGetterAndSelector } from '../lib/selectors'
import { deleteAllFileRecords } from './files'
import { getHasOnboarded, setRecoveryPhrase, setHasOnboarded } from './settings'
import {
  initSdk,
  reconnect,
  resetSdk,
  tryToConnectAndSet,
  type ConnectResult,
} from './sdk'
import { initUploadScanner } from '../managers/uploadScanner'
import { cancelAllUploads } from './uploads'
import { cancelAllDownloads } from './downloads'
import { initLogger } from './logs'
import { fsEnsureDir } from './fs'
import { tempFsEnsureDir } from './tempFs'
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
import { initFsScanner } from '../managers/fsScanner'
import { shutdownAllServiceIntervals } from '../lib/serviceInterval'

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
        await fsEnsureDir()
        await tempFsEnsureDir()
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
      runner: async (updateDetail) => {
        const sdk = await initSdk()
        if (!sdk) {
          throw new Error('Failed to initialize SDK.')
        }
        updateDetail('Connecting to indexer...')
        const connected = await reconnect()
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
      initFsScanner()
    },
  })

  await runSteps(steps)

  endInitState()
}

export async function onboardIndexer(
  indexerURL: string
): Promise<ConnectResult> {
  return tryToConnectAndSet(indexerURL)
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
        await setRecoveryPhrase('')
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

export function useIsInitializing(): boolean {
  return useAppInitStore((s) => s.isInitializing)
}

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
