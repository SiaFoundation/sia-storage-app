import useSWR from 'swr'
import { useApp } from '../app/context'

/** Fetches the full details for a single file by its ID. */
export function useFileDetails(id: string) {
  const app = useApp()
  return useSWR(app.caches.fileById.key(id), () => app.files.getById(id))
}

/** Returns the total count of all active (non-trashed) files in the library. */
export function useFileCountAll() {
  const app = useApp()
  return useSWR(app.caches.library.key('count'), () =>
    app.files.queryCount({
      limit: undefined,
      after: undefined,
      order: 'ASC',
      activeOnly: true,
    }),
  )
}

/** Returns aggregate stats (e.g. total size) for all active files in the library. */
export function useFileStatsAll() {
  const app = useApp()
  return useSWR(app.caches.library.key('stats'), () =>
    app.files.queryStats({
      limit: undefined,
      after: undefined,
      order: 'ASC',
      activeOnly: true,
    }),
  )
}
