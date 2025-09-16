import { create } from 'zustand'
import { Sdk } from 'react-native-sia'
import authApp from '../lib/authApp'
import { createSeed, loadSeed, storeSeed } from '../lib/seed'
import { logger } from '../lib/logger'
import { deleteAllFileRecords } from './files'
import { getSecureStoreBoolean, setSecureStoreBoolean } from './secureStore'

export type AuthState = {
  sdk: Sdk | null
  isInitializing: boolean
  hasOnboarded: boolean
  isConnected: boolean
  connectionError: string | null
  isAuthing: boolean
  indexerName: string
  indexerURL: string
  appSeed: Uint8Array<ArrayBuffer>
  setIndexerName: (value: string) => void
  setIndexerURL: (value: string) => void
  setAppSeed: (seed: Uint8Array<ArrayBuffer>) => Promise<void>
  reconnect: () => Promise<boolean | undefined>
  initSdk: () => Promise<Sdk | null>
  tryToConnectAndSet: (nextIndexerURL: string) => Promise<boolean>
  resetApp: () => Promise<void>
  setHasOnboarded: (value: boolean) => Promise<void>
  initAuth: () => Promise<void>
  initOnboarded: () => Promise<void>
  initSeed: () => Promise<void>
}

const DEFAULT_INDEXER_NAME = 'Test'
const DEFAULT_INDEXER_URL = 'https://app.sia.storage'

const SECURE_STORE_ONBOARDING_KEY = 'hasOnboarded'

export const useAuthStore = create<AuthState>((set, get) => {
  const initialSeed = createSeed()

  return {
    sdk: null,
    isInitializing: true,
    isConnected: false,
    connectionError: null,
    isAuthing: false,
    hasOnboarded: false,
    indexerName: DEFAULT_INDEXER_NAME,
    indexerURL: DEFAULT_INDEXER_URL,
    appSeed: initialSeed,

    setIndexerName: (value) => set({ indexerName: value }),
    setIndexerURL: (value) => set({ indexerURL: value }),

    setAppSeed: async (seed) => {
      set({ appSeed: seed })
      await storeSeed(seed)
    },

    reconnect: async () => {
      logger.log('Reconnecting...')
      const isAuthing = get().isAuthing
      if (isAuthing) {
        return false
      }
      const sdk = get().sdk || (await get().initSdk())

      if (!sdk) {
        set({ connectionError: 'Failed to initialize SDK' })
        return false
      }

      const connected = await sdk.connect()
      set({
        isConnected: connected,
        connectionError: connected ? null : 'Failed to connect to indexer',
      })
      return connected
    },

    setHasOnboarded: async (value: boolean) => {
      set({ hasOnboarded: value })
      await setSecureStoreBoolean(SECURE_STORE_ONBOARDING_KEY, value)
    },

    initOnboarded: async () => {
      return set({
        hasOnboarded: await getSecureStoreBoolean(SECURE_STORE_ONBOARDING_KEY),
      })
    },

    initSeed: async () => {
      let seed = await loadSeed()
      if (!seed) {
        seed = createSeed()
        await storeSeed(seed)
      }
      set({ appSeed: seed })
    },

    initSdk: async () => {
      try {
        const indexerURL = get().indexerURL
        const sdk = new Sdk(indexerURL, get().appSeed.buffer)
        set({ sdk })
        return sdk
      } catch (err) {
        logger.log('Error initializing SDK', err)
        return null
      }
    },

    initAuth: async () => {
      await get().initOnboarded()
      await get().initSeed()
      if (get().hasOnboarded) {
        await get().initSdk()
        await get().reconnect()
      }
      set({ isInitializing: false })
    },

    tryToConnectAndSet: async (newIndexerURL: string) => {
      const appSeed = get().appSeed
      set({
        isAuthing: true,
      })
      try {
        logger.log(
          `Creating candidate SDK for ${newIndexerURL} with ${appSeed.toString()}...`
        )
        const candidate = new Sdk(newIndexerURL, appSeed.buffer)

        logger.log('Calling connect...')
        const connected = await candidate.connect()

        if (!connected) {
          logger.log('No connection. Requesting app connection...')
          const url = await candidate.requestAppConnection({
            name: 'Test',
            description: 'Test',
            serviceUrl: 'https://sia.storage',
            callbackUrl: 'siamobile://callback',
            logoUrl: 'https://sia.storage/logo.png',
          })

          authApp(url.responseUrl)

          const authorized = await candidate.waitForConnect(url)
          if (!authorized) {
            logger.log('App not authorized')
            set({
              isAuthing: false,
            })
            return false
          }
        }

        logger.log('Connected. Setting active indexer.')
        set({
          sdk: candidate,
          isConnected: true,
          indexerURL: newIndexerURL,
          isAuthing: false,
        })
        await get().setHasOnboarded(true)
        return true
      } catch (err) {
        logger.log('Error connecting to indexer', err)
        set({ isAuthing: false })
        return false
      }
    },

    resetApp: async () => {
      await deleteAllFileRecords()
      const newSeed = createSeed()
      await get().setAppSeed(newSeed)
      await get().setHasOnboarded(false)
      set({
        isConnected: false,
        sdk: null,
        isAuthing: false,
        connectionError: null,
      })
    },
  }
})

// actions

export function authReconnect() {
  return useAuthStore.getState().reconnect()
}

export function authInitSdk() {
  return useAuthStore.getState().initSdk()
}

export function useSdk(): Sdk | null {
  return useAuthStore((s) => s.sdk)
}

export function setIndexerName(value: string) {
  return useAuthStore.getState().setIndexerName(value)
}

export function setIndexerURL(value: string) {
  return useAuthStore.getState().setIndexerURL(value)
}

export function resetApp() {
  return useAuthStore.getState().resetApp()
}

export function setAppSeed(seed: Uint8Array<ArrayBuffer>) {
  return useAuthStore.getState().setAppSeed(seed)
}

export function tryToConnectAndSet(newIndexerURL: string) {
  return useAuthStore.getState().tryToConnectAndSet(newIndexerURL)
}

export function initAuth() {
  return useAuthStore.getState().initAuth()
}

export function setHasOnboarded(value: boolean) {
  return useAuthStore.getState().setHasOnboarded(value)
}

// selectors

export function useIsInitializing(): boolean {
  return useAuthStore((s) => s.isInitializing)
}

export function useIsConnected(): boolean {
  return useAuthStore((s) => s.isConnected)
}

export function useIsAuthing(): boolean {
  return useAuthStore((s) => s.isAuthing)
}

export function useAppSeed(): Uint8Array<ArrayBuffer> {
  return useAuthStore((s) => s.appSeed)
}

export function useIndexerURL(): string {
  return useAuthStore((s) => s.indexerURL)
}

export function useIndexerName(): string {
  return useAuthStore((s) => s.indexerName)
}

export function useHasOnboarded(): boolean {
  return useAuthStore((s) => s.hasOnboarded)
}
