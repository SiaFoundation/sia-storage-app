import { create } from 'zustand'
import { deleteAllFileRecords } from './files'
import { getHasOnboarded, setRecoveryPhrase, setHasOnboarded } from './settings'
import * as SplashScreen from 'expo-splash-screen'
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
import { ensureCacheDir } from './fileCache'
import { resetDb } from '../db'
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

export type AppState = {
  isInitializing: boolean
}

const useAppStore = create<AppState>(() => {
  return {
    isInitializing: true,
  }
})

const { setState } = useAppStore

export async function initApp() {
  initLogger()
  await ensureCacheDir()
  const hasOnboarded = await getHasOnboarded()
  if (hasOnboarded) {
    await initSdk()
    await reconnect()
  }
  setState({ isInitializing: false })
  await SplashScreen.hideAsync()
  initUploadScanner()
  initSyncDownEvents()
  initSyncNewPhotos()
  initSyncPhotosArchive()
  initBackgroundTasks()
  initSyncUpMetadata()
  initThumbnailScanner()
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
  await resetData()
  await setRecoveryPhrase('')
  await setHasOnboarded(false)
  await resetSdk()
  await resetPhotosNewCursor()
  await resetPhotosArchiveCursor()
}

// selectors

export function useIsInitializing(): boolean {
  return useAppStore((s) => s.isInitializing)
}
