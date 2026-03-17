import useSWR from 'swr'
import { useApp } from '../app/context'
import { useIsConnected } from './connection'

/** Fetches all hosts from the connected server, polling every 20 seconds. */
export function useHosts() {
  const app = useApp()
  const isConnected = useIsConnected()
  return useSWR(
    isConnected ? app.caches.hosts.key() : null,
    () => app.hosts(),
    { revalidateOnFocus: false, refreshInterval: 20_000 },
  )
}

/** Returns a single host by its public key from the cached hosts list. */
export function useHost(publicKey: string) {
  const app = useApp()
  const hosts = useHosts()
  return useSWR(hosts.data ? app.caches.hosts.key(publicKey) : null, () =>
    hosts.data?.find((h) => h.publicKey === publicKey),
  )
}
