import useSWR from 'swr'
import { useApp } from '../app/context'

/**
 * The links on the current indexer that have not expired, newest first.
 * Each read resolves every file on every link, so a caller that only counts
 * them can turn off the reread SWR makes when the window regains focus.
 */
export function useShareLinks({ revalidateOnFocus = true }: { revalidateOnFocus?: boolean } = {}) {
  const app = useApp()
  return useSWR(app.caches.shareLinks.key('all'), () => app.shares.links(), { revalidateOnFocus })
}
