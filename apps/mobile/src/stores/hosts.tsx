import useSWR from 'swr'
import { swrCache, swrCacheBy } from '../lib/swr'
import { useSdk } from './sdk'

/** Full list of all hosts. */
const allHostsCache = swrCache()

/** Single host keyed by public key. */
const hostByKeyCache = swrCacheBy()

export function useHosts() {
  const sdk = useSdk()
  return useSWR(sdk ? allHostsCache.key() : null, () => sdk!.hosts(), {
    revalidateOnFocus: false,
    refreshInterval: 20_000,
  })
}

export function useHost(publicKey: string) {
  const hosts = useHosts()
  return useSWR(hosts.data ? hostByKeyCache.key(publicKey) : null, () =>
    hosts.data?.find((h) => h.publicKey === publicKey),
  )
}
