import { create } from 'zustand'
import { generateRecoveryPhrase } from 'react-native-sia'
import { deleteAllFileRecords } from './files'
import { getHasOnboarded, setRecoveryPhrase, setHasOnboarded } from './settings'
import * as SplashScreen from 'expo-splash-screen'
import { initSdk, reconnect, resetSdk } from './sdk'
import { initUploadScanner, stopUploadScanner } from '../managers/uploadScanner'
import { cancelAllTransfers } from './transfers'
import { initLogger } from './logs'

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
  const hasOnboarded = await getHasOnboarded()
  if (hasOnboarded) {
    await initSdk()
    await reconnect()
  }
  setState({ isInitializing: false })
  await SplashScreen.hideAsync()
  await initUploadScanner()
}

export function shutdownApp() {
  cancelAllTransfers()
  stopUploadScanner()
}

export async function resetApp() {
  await deleteAllFileRecords()
  const newSeed = generateRecoveryPhrase()
  await setRecoveryPhrase(newSeed)
  await setHasOnboarded(false)
  await resetSdk()
}

// selectors

export function useIsInitializing(): boolean {
  return useAppStore((s) => s.isInitializing)
}
