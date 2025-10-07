import { useEffect, useRef } from 'react'
import NetInfo from '@react-native-community/netinfo'
import { reconnect, useIsConnected } from '../stores/sdk'
import { logger } from '../lib/logger'
import { getIsOnline } from './useIsOnline'
import { useIsInitializing } from '../stores/app'

export function useReconnectIndexer() {
  const reconnectingRef = useRef(false)
  const isIndexerConnected = useIsConnected()
  const isInitializing = useIsInitializing()

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const isOnline = getIsOnline(state)

      if (
        !isInitializing &&
        !isIndexerConnected &&
        isOnline &&
        !reconnectingRef.current
      ) {
        reconnectingRef.current = true
        logger.log('[netinfo] app is now online, reconnecting...')
        void reconnect().finally(() => {
          reconnectingRef.current = false
        })
      }
    })
    return () => unsubscribe()
  }, [])
}
