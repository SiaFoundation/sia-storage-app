import NetInfo, { type NetInfoState } from '@react-native-community/netinfo'
import { logger } from '@siastorage/logger'
import { useEffect } from 'react'
import useSWR from 'swr'

export async function getIsOnline(
  customState?: NetInfoState,
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
  }, [isOnline.mutate])

  useEffect(() => {
    if (isOnline.isLoading) {
      return
    }
    logger.debug('netinfo', 'connectivity_changed', {
      online: isOnline.data,
    })
  }, [isOnline.data, isOnline.isLoading])

  return isOnline
}
