import { create } from 'zustand'
import { Sdk } from 'react-native-sia'
import authApp from '../lib/authApp'
import { createSeed } from '../lib/seed'
import { logger } from '../lib/logger'
import { deleteAllFileRecords } from './files'
import {
  getHasOnboarded,
  setSeed,
  getSeed,
  setHasOnboarded,
  getIndexerURL,
} from './settings'

export type AuthState = {
  sdk: Sdk | null
  isInitializing: boolean
  isConnected: boolean
  connectionError: string | null
  isAuthing: boolean
  reconnect: () => Promise<boolean | undefined>
  initSdk: () => Promise<Sdk | null>
  tryToConnectAndSet: (nextIndexerURL: string) => Promise<boolean>
  resetApp: () => Promise<void>
  initAuth: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => {
  return {
    sdk: null,
    isInitializing: true,
    isConnected: false,
    connectionError: null,
    isAuthing: false,

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

    initSdk: async () => {
      try {
        const seed = await getSeed()
        const indexerURL = await getIndexerURL()
        const sdk = new Sdk(indexerURL, seed.buffer)
        set({ sdk })
        return sdk
      } catch (err) {
        logger.log('Error initializing SDK', err)
        return null
      }
    },

    initAuth: async () => {
      const hasOnboarded = await getHasOnboarded()
      if (hasOnboarded) {
        await get().initSdk()
        get().reconnect()
      }
      set({ isInitializing: false })
    },

    tryToConnectAndSet: async (newIndexerURL: string) => {
      const appSeed = await getSeed()
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
          isAuthing: false,
        })
        await setHasOnboarded(true)
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
      await setSeed(newSeed)
      await setHasOnboarded(false)
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

export function resetApp() {
  return useAuthStore.getState().resetApp()
}

export function tryToConnectAndSet(newIndexerURL: string) {
  return useAuthStore.getState().tryToConnectAndSet(newIndexerURL)
}

export function initAuth() {
  return useAuthStore.getState().initAuth()
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

export function getSdk(): Sdk | null {
  return useAuthStore.getState().sdk
}
