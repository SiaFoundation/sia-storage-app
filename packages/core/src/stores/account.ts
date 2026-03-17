import useSWR from 'swr'
import { useApp } from '../app/context'
import { useIsConnected } from './connection'

/** Fetches the current user's account info, only when connected to a server. */
export function useAccount() {
  const app = useApp()
  const isConnected = useIsConnected()
  return useSWR(isConnected ? ['account'] : null, () => app.account())
}
