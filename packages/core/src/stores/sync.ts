import useSWR from 'swr'
import { useApp } from '../app/context'

/** Returns the current sync state including progress and last sync time. */
export function useSyncState() {
  const app = useApp()
  return useSWR(app.caches.sync.key(), () => app.sync.getState())
}
