import useSWR from 'swr'
import { useSettings } from '../lib/settingsContext'

export function useHosts() {
  const { sdk } = useSettings()
  return useSWR(sdk ? ['sdk/hosts'] : null, async () => sdk.hosts(), {
    revalidateOnFocus: false,
    refreshInterval: 20_000,
  })
}

export function useHost(publicKey: string) {
  const hosts = useHosts()
  return useSWR(hosts.data ? ['sdk/host', publicKey] : null, () =>
    hosts.data?.find((h) => h.publicKey === publicKey)
  )
}
