import { create } from 'zustand'
import { generateRecoveryPhrase } from 'react-native-sia'
import { deleteAllFileRecords } from './files'
import { getHasOnboarded, setRecoveryPhrase, setHasOnboarded } from './settings'
import * as SplashScreen from 'expo-splash-screen'
import { initSdk, reconnect, resetSdk, tryToConnectAndSet } from './sdk'
import { initUploadScanner } from '../managers/uploadScanner'
import { cancelAllTransfers } from './transfers'
import { initLogger } from './logs'
import { ensureCacheDir } from './fileCache'
import { resetDb } from '../db'
import { initSyncDownObjects } from '../managers/syncDownObjects'

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
  initSyncDownObjects()
}

export async function onboardIndexer(indexerURL: string) {
  const success = await tryToConnectAndSet(indexerURL)
  if (!success) {
    return false
  }

  await setHasOnboarded(true)
  return success
}

export function shutdownApp() {
  cancelAllTransfers()
}

export async function resetApp() {
  await deleteAllFileRecords()
  await resetDb()
  const newSeed = generateRecoveryPhrase()
  await setRecoveryPhrase(newSeed)
  await setHasOnboarded(false)
  await resetSdk()
}

// selectors

export function useIsInitializing(): boolean {
  return useAppStore((s) => s.isInitializing)
}
