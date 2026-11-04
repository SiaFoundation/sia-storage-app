import useSWR from 'swr'
import { useApp } from '../app/context'
import { reloadList, useOnLibraryListChange } from './library'

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

/**
 * The files added most recently, newest first. Reloaded on every library
 * change, not only when the library cache is cleared, because some writes
 * bump only the library version: `files.update`, such as the uploader marking
 * an empty file lost, and a folder rename or move.
 */
export function useRecentFiles(limit: number) {
  const app = useApp()
  const swr = useSWR(
    app.caches.library.key('recent', String(limit)),
    async () => app.files.recent(await app.settings.getIndexerURL(), limit),
    { keepPreviousData: true },
  )
  useOnLibraryListChange((version) =>
    reloadList(app, `recent/${limit}`, version, () => swr.mutate()),
  )
  return swr
}
