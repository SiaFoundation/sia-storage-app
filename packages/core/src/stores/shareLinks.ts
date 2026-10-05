import useSWR from 'swr'
import { useApp } from '../app/context'

/** The links on the current indexer that have not expired, newest first. */
export function useShareLinks() {
  const app = useApp()
  return useSWR(app.caches.shareLinks.key('all'), () => app.shares.links())
}
