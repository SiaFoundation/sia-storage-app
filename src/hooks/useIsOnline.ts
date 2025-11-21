import { useEffect } from 'react'
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo'
import { logger } from '../lib/logger'
import useSWR from 'swr'

export async function getIsOnline(
  customState?: NetInfoState
): Promise<boolean> {
  const state = customState || (await NetInfo.fetch())
  const reachable = state.isInternetReachable
  if (reachable !== null) return Boolean(reachable)
  return Boolean(state.isConnected)
}

export function useIsOnline() {
  const isOnline = useSWR('onlineStatus', async () => {
    return getIsOnline()
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
