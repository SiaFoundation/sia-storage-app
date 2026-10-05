import useSWR from 'swr'
import { useApp } from '../app/context'

/** Fetches the full details for a single file by its ID. */
export function useFileDetails(id: string) {
  const app = useApp()
  return useSWR(app.caches.fileById.key(id), () => app.files.getById(id))
}

/**
 * Returns the count of active (non-trashed) files in the library. Thumbnails
 * are rows in the same table and are left out, so the number matches what a
 * file browser shows.
 */
export function useFileCountAll() {
  const app = useApp()
  return useSWR(app.caches.library.key('count'), () =>
    app.files.queryCount({
      limit: undefined,
      after: undefined,
      order: 'ASC',
      includeThumbnails: false,
    }),
  )
}

/** Returns aggregate stats (e.g. total size) for the files `useFileCountAll` counts. */
export function useFileStatsAll() {
  const app = useApp()
  return useSWR(app.caches.library.key('stats'), () =>
    app.files.queryStats({
      limit: undefined,
      after: undefined,
      order: 'ASC',
      includeThumbnails: false,
    }),
  )
}
