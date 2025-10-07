import { create } from 'zustand'
import { generateRecoveryPhrase, Sdk } from 'react-native-sia'
import authApp from '../lib/authApp'
import { logger } from '../lib/logger'
import { deleteAllFileRecords } from './files'
import {
  getHasOnboarded,
  setRecoveryPhrase,
  setHasOnboarded,
  getIndexerURL,
} from './settings'
import { getAppKey } from '../lib/appKey'
import { createGetterAndSelector } from '../lib/selectors'

export type AuthState = {
  sdk: Sdk | null
  isInitializing: boolean
  isConnected: boolean
  connectionError: string | null
  isAuthing: boolean
}

const useAuthStore = create<AuthState>(() => {
  return {
    sdk: null,
    isInitializing: true,
    isConnected: false,
    connectionError: null,
    isAuthing: false,
  }
})

const { getState, setState } = useAuthStore

export async function reconnect() {
  logger.log('Reconnecting...')
  const isAuthing = getState().isAuthing
  if (isAuthing) {
    return false
  }
  const sdk = getState().sdk || (await initSdk())
  if (!sdk) {
    setState({ connectionError: 'Failed to initialize SDK' })
    return false
  }
  const connected = await sdk.connect()
  setState({
    isConnected: connected,
    connectionError: connected ? null : 'Failed to connect to indexer',
  })
  return connected
}

export async function initSdk() {
  try {
    const indexerURL = await getIndexerURL()
    const appKey = await getAppKey()
    const sdk = new Sdk(indexerURL, appKey)
    setState({ sdk })
    return sdk
  } catch (err) {
    logger.log('Error initializing SDK', err)
    return null
  }
}

export function useSdk(): Sdk | null {
  return useAuthStore((s) => s.sdk)
}

export async function resetApp() {
  await deleteAllFileRecords()
  const newSeed = generateRecoveryPhrase()
  await setRecoveryPhrase(newSeed)
  await setHasOnboarded(false)
  setState({
    isConnected: false,
    sdk: null,
    isAuthing: false,
    connectionError: null,
  })
}

export async function tryToConnectAndSet(newIndexerURL: string) {
  setState({
    isAuthing: true,
  })
  try {
    logger.log(`Creating candidate SDK for ${newIndexerURL}...`)
    const appKey = await getAppKey()
    const candidate = new Sdk(newIndexerURL, appKey)

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
        setState({
          isAuthing: false,
        })
        return false
      }
    }

    logger.log('Connected. Setting active indexer.')
    setState({
      sdk: candidate,
      isConnected: true,
      isAuthing: false,
    })
    await setHasOnboarded(true)
    return true
  } catch (err) {
    logger.log('Error connecting to indexer', err)
    setState({ isAuthing: false })
    return false
  }
}

export async function initAuth() {
  const hasOnboarded = await getHasOnboarded()
  if (hasOnboarded) {
    await initSdk()
    await reconnect()
  }
  setState({ isInitializing: false })
}

// selectors

export function useIsInitializing(): boolean {
  return useAuthStore((s) => s.isInitializing)
}

export const [getIsConnected, useIsConnected] = createGetterAndSelector(
  useAuthStore,
  (s) => s.isConnected
)

export function useIsAuthing(): boolean {
  return useAuthStore((s) => s.isAuthing)
}

export function getSdk(): Sdk | null {
  return useAuthStore.getState().sdk
}
