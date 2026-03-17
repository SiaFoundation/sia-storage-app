import useSWR from 'swr'
import { useApp } from '../app/context'

/** Returns the full connection state including host details and connectivity status. */
export function useConnectionState() {
  const app = useApp()
  return useSWR(app.caches.connection.key(), () => app.connection.getState())
}

/** Returns whether the app is currently connected to a Sia server. */
export function useIsConnected(): boolean {
  const { data } = useConnectionState()
  return data?.isConnected ?? false
}
