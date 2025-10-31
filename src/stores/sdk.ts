import { create } from 'zustand'
import { Sdk } from 'react-native-sia'
import authApp from '../lib/authApp'
import { logger } from '../lib/logger'
import { setHasOnboarded, getIndexerURL } from './settings'
import { getAppKey } from '../lib/appKey'
import { createGetterAndSelector } from '../lib/selectors'
import { onboardIndexer } from './app'

export type SdkState = {
  sdk: Sdk | null
  isConnected: boolean
  connectionError: string | null
  isAuthing: boolean
}

const useSdkStore = create<SdkState>(() => {
  return {
    sdk: null,
    isConnected: false,
    connectionError: null,
    isAuthing: false,
  }
})

const { getState, setState } = useSdkStore

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
  const controller = new AbortController()
  setTimeout(() => {
    controller.abort()
  }, 5000)
  try {
    const connected = await sdk.connected({
      signal: controller.signal,
    })
    setState({
      isConnected: connected,
      connectionError: connected ? null : 'Failed to connect to indexer',
    })
    return connected
  } catch (e) {
    setState({
      isConnected: false,
      connectionError: 'Failed to connect to indexer',
    })
    return false
  }
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

export async function resetSdk() {
  setState({
    sdk: null,
    isConnected: false,
    connectionError: null,
    isAuthing: false,
  })
}

export function useSdk(): Sdk | null {
  return useSdkStore((s) => s.sdk)
}

export async function tryToConnectAndSet(newIndexerURL: string) {
  setState({
    isAuthing: true,
  })
  try {
    logger.log(`Creating candidate SDK for ${newIndexerURL}...`)
    const appKey = await getAppKey()
    const candidate = new Sdk(newIndexerURL, appKey)

    logger.log('Calling connected...')
    const connected = await candidate.connected()

    if (!connected) {
      logger.log('No connection. Requesting app connection...')
      const url = await candidate.requestAppConnection({
        name: 'Test',
        description: 'Test',
        serviceUrl: 'https://sia.storage',
        callbackUrl: 'sia://callback',
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
    return true
  } catch (err) {
    logger.log('Error connecting to indexer', err)
    setState({ isAuthing: false })
    return false
  }
}

export function setIsConnected(connected: boolean) {
  return useSdkStore.setState({ isConnected: connected })
}

// selectors

export const [getIsConnected, useIsConnected] = createGetterAndSelector(
  useSdkStore,
  (s) => s.isConnected
)

export function useIsAuthing(): boolean {
  return useSdkStore((s) => s.isAuthing)
}

export function getSdk(): Sdk | null {
  return useSdkStore.getState().sdk
}
