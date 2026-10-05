import useSWR from 'swr'
import { useApp } from '../app/context'

/** Fetches the upload state for a single file by its ID. */
export function useUploadEntry(id: string) {
  const app = useApp()
  return useSWR(app.caches.uploads.key(id), () => app.uploads.getEntry(id))
}

/**
 * Running-average upload throughput (fileBps of user data, rawBps on the
 * wire), or null until enough transfer has been measured. Updated by
 * upload events the SWR cache never sees, so it polls every
 * `refreshInterval` ms while mounted instead of relying on cache
 * invalidation.
 */
export function useUploadSpeed({ refreshInterval = 1_000 }: { refreshInterval?: number } = {}) {
  const app = useApp()
  return useSWR(app.caches.uploads.key('speed'), () => app.uploader.uploadSpeed(), {
    refreshInterval,
  })
}
