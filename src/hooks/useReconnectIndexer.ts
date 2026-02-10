import NetInfo from '@react-native-community/netinfo'
import { useEffect } from 'react'
import { logger } from '../lib/logger'
import { getIsInitializing, useIsInitializing } from '../stores/app'
import { getIsConnected, reconnectIndexer, useIsConnected } from '../stores/sdk'
import { getIsOnline, useIsOnline } from './useIsOnline'

export function useReconnectIndexer() {
  // Try to reconnect to the indexer when the app reconnects to the internet.
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(async (state) => {
      const isOnline = await getIsOnline(state)
      const isIndexerConnected = getIsConnected()
      const isInitializing = getIsInitializing()

      if (!isInitializing && !isIndexerConnected && isOnline) {
        logger.info('netinfo', 'online_reconnecting')
        await reconnectIndexer()
      }
    })
    return () => unsubscribe()
  }, [])

  // Try to reconnect to the indexer when the app is online but not connected to the indexer.
  const isInitializing = useIsInitializing()
  const isOnline = useIsOnline()
  const isIndexerConnected = useIsConnected()
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null
    if (!isInitializing && isOnline && !isIndexerConnected) {
      interval = setInterval(async () => {
        const isOnline = await getIsOnline()
        const isIndexerConnected = getIsConnected()
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
