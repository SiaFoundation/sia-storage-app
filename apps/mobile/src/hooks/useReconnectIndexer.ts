import NetInfo from '@react-native-community/netinfo'
import { useIsInitializing } from '@siastorage/core/stores'
import { logger } from '@siastorage/logger'
import { useEffect } from 'react'
import { app } from '../stores/appService'
import { reconnectIndexer, useIsConnected } from '../stores/sdk'
import { getIsOnline, useIsOnline } from './useIsOnline'

export function useReconnectIndexer() {
  // Try to reconnect to the indexer when the app reconnects to the internet.
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(async (state) => {
      const isOnline = await getIsOnline(state)
      const isIndexerConnected = app().connection.getState().isConnected
      const isInitializing = app().init.getState().isInitializing

      if (!isInitializing && !isIndexerConnected && isOnline) {
        logger.info('netinfo', 'online_reconnecting')
        await reconnectIndexer()
      }
    })
    return () => unsubscribe()
  }, [])

  // Try to reconnect to the indexer when the app is online but not connected to the indexer.
  const isInitializing = useIsInitializing()
  const { data: isOnline } = useIsOnline()
  const isIndexerConnected = useIsConnected()
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null
    if (!isInitializing && isOnline && !isIndexerConnected) {
      interval = setInterval(async () => {
        const isOnline = await getIsOnline()
        const isIndexerConnected = app().connection.getState().isConnected
        if (isOnline && !isIndexerConnected) {
          logger.info('netinfo', 'indexer_disconnected_reconnecting')
          reconnectIndexer()
        }
      }, 5_000)
    }
    return () => {
      if (interval) {
        clearInterval(interval)
      }
    }
  }, [isOnline, isIndexerConnected, isInitializing])
}
