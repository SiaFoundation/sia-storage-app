import { useConnectionState } from './connection'

/** Returns a truthy signal when the SDK is connected, or null otherwise. */
export function useSdk() {
  const { data } = useConnectionState()
  return { data: data?.isConnected ? true : null }
}
