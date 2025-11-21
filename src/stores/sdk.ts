import { create } from 'zustand'
import { Sdk, type PinnedObjectInterface } from 'react-native-sia'
import authApp from '../lib/authApp'
import { logger } from '../lib/logger'
import { getIndexerURL } from './settings'
import { getAppKey } from '../lib/appKey'
import { createGetterAndSelector } from '../lib/selectors'

export type SdkState = {
  sdk: Sdk | null
  isConnected: boolean
  connectionError: string | null
  isAuthing: boolean
  isReconnecting: boolean
}

const useSdkStore = create<SdkState>(() => {
  return {
    sdk: null,
    isConnected: false,
    connectionError: null,
    isAuthing: false,
    isReconnecting: false,
  }
})

const { getState, setState } = useSdkStore

export async function reconnect(): Promise<boolean> {
  if (getState().isReconnecting) {
    logger.log('[sdk] already reconnecting, skipping')
    return false
  }
  setState({ isReconnecting: true })

  logger.log('[sdk] reconnecting...')
  const isAuthing = getState().isAuthing
  if (isAuthing) {
    logger.log('[sdk] already authing, skipping')
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
  } finally {
    setState({ isReconnecting: false })
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

export type ConnectResult = 'success' | 'cancelled' | 'error'

export async function tryToConnectAndSet(
  newIndexerURL: string
): Promise<ConnectResult> {
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
        name: 'Sia Storage',
        description: 'Privacy-first, decentralized cloud storage',
        serviceUrl: 'https://sia.storage',
        callbackUrl: 'sia://callback',
        logoUrl: 'https://sia.storage/logo.png',
      })

      const waitForConnect = candidate.waitForConnect(url)
      const authCompleted = await authApp(url.responseUrl)
      if (!authCompleted) {
        logger.log('App authorization cancelled by user')
        void waitForConnect.catch(() => {})
        setState({
          isAuthing: false,
        })
        return 'cancelled'
      }

      const authorized = await waitForConnect
      if (!authorized) {
        logger.log('App not authorized')
        setState({
          isAuthing: false,
        })
        return 'error'
      }
    }

    logger.log('Connected. Setting active indexer.')
    setState({
      sdk: candidate,
      isConnected: true,
      isAuthing: false,
    })
    return 'success'
  } catch (err) {
    logger.log('Error connecting to indexer', err)
    setState({ isAuthing: false })
    return 'error'
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

/**
 * Update the metadata of a pinned object.
 */ export async function updateMetadata(
  pinnedObject: PinnedObjectInterface,
  metadata: ArrayBuffer
): Promise<void> {
  const sdk = getSdk()
  if (!sdk) {
    throw new Error('SDK not initialized')
  }
  pinnedObject.updateMetadata(metadata)
  await sdk.saveObject(pinnedObject)
}

/**
 * Fetch a pinned object by id.
 */
export async function getPinnedObject(
  objectId: string
): Promise<PinnedObjectInterface> {
  const sdk = getSdk()
  if (!sdk) {
    throw new Error('SDK not initialized')
  }
  return sdk.object(objectId)
}
