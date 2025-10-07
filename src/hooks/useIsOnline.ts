import { useEffect } from 'react'
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo'
import { logger } from '../lib/logger'
import useSWR from 'swr'

export function getIsOnline(state: NetInfoState): boolean {
  const reachable = state.isInternetReachable
  if (reachable !== null) return Boolean(reachable)
  return Boolean(state.isConnected)
}

export function useIsOnline() {
  const isOnline = useSWR('onlineStatus', async () => {
    const state = await NetInfo.fetch()
    return getIsOnline(state)
  })

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(() => {
      isOnline.mutate()
    })
    return () => unsubscribe()
  }, [isOnline])

  useEffect(() => {
    if (isOnline.isLoading) {
      return
    }
    logger.log(`[netinfo] app is now ${isOnline.data ? 'online' : 'offline'}`)
  }, [isOnline.data])

  return isOnline
}
