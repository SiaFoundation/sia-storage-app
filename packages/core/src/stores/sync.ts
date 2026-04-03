import { useEffect } from 'react'
import useSWR from 'swr'
import { useApp } from '../app/context'
import { useIsConnected } from './connection'

/** Returns the current sync state including progress and last sync time. */
export function useSyncState() {
  const app = useApp()
  return useSWR(app.caches.sync.key(), () => app.sync.getState())
}

/** Returns the current sync gate status for the initial catch-up overlay. */
export function useSyncGateStatus() {
  const { data } = useSyncState()
  return data?.syncGateStatus ?? 'idle'
}

/**
 * Safety-net hook that auto-dismisses the sync gate on connection drop.
 * Without this, a disconnect while the gate is active would leave it stuck
 * because the sync service skips runs when not connected.
 */
export function useSyncGateGuard() {
  const app = useApp()
  const syncGateStatus = useSyncGateStatus()
  const isConnected = useIsConnected()

  useEffect(() => {
    if (syncGateStatus === 'active' && isConnected === false) {
      app.sync.setState({ syncGateStatus: 'dismissed' })
    }
  }, [syncGateStatus, isConnected, app])
}
