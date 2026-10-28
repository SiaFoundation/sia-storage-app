import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import useSWRInfinite, { unstable_serialize } from 'swr/infinite'
import type { AppService } from '../app/service'
import { useApp } from '../app/context'
import type { LibraryQueryParams, SortBy, SortDir } from '../db/operations'
import { transformRow } from '../db/operations'
import type { FileRecord, FileRecordRow } from '../types/files'

const PAGE_SIZE = 40

type LibraryRow = FileRecordRow & { isFavorite: number; fsExists: number }

/**
 * Populate per-row SWR caches from the joined columns returned by
 * `queryLibrary`. Each list row component then renders its
 * `useIsFavorite` and `useFsFileUri` from cache instead of firing its
 * own query. `fsExists` priming trusts the DB row; `useFsFileUri`'s
 * fetcher self-heals on disk drift.
 *
 * `since` is the caches' mark from before the query ran. `fill` skips any
 * entry written after it, such as a download finishing or a favorite
 * toggled while the query ran, since the row read before that write is
 * older than it.
 */
export function primeListRowCaches(
  app: AppService,
  rows: LibraryRow[],
  since: { tags: number; fsFileUri: number },
): void {
  for (const row of rows) {
    app.caches.tags.fill(since.tags, !!row.isFavorite, `favorite/${row.id}`)
    app.caches.fsFileUri.fill(
      since.fsFileUri,
      row.fsExists ? app.fs.uri({ id: row.id, type: row.type }) : null,
      row.id,
    )
  }
}

/** Parameters for querying a paginated, sortable, and filterable file list. */
export type FileListParams = {
  scope: string
  sortBy?: SortBy
  sortDir?: SortDir
  categories?: LibraryQueryParams['categories']
  query?: string
  tags?: string[]
  directoryId?: string
}

/** Invokes a callback with the new library list version whenever it changes. */
export function useOnLibraryListChange(callback: (version: number) => void) {
  const app = useApp()
  const callbackRef = useRef(callback)
  callbackRef.current = callback
  const version = useSyncExternalStore(
    (onChange) => app.caches.libraryVersion.subscribe(onChange),
    () => app.caches.libraryVersion.getVersion(),
  )
  const versionRef = useRef(version)
  useEffect(() => {
    if (version === versionRef.current) return
    versionRef.current = version
    callbackRef.current(version)
  }, [version])
}

// SWR starts a new request on every mutate() and discards the one in flight
// without stopping its reads, and a list reload reads every loaded page in
// turn. Library changes arriving faster than a reload finishes then kept the
// list from ever updating, so the grid's "loading more" spinner never
// cleared, and the abandoned reloads filled the read pool's queue. One reload
// per list runs at a time, and changes during it get one more reload after
// it. Keyed by list, since the library screen and its grid each hold the
// same list and both see every change, and by app, since each app counts
// its versions from zero.
type ListReload = { version: number; again: boolean }
const listReloads = new WeakMap<AppService, Map<string, ListReload>>()

function reloadList(app: AppService, key: string, version: number, reload: () => Promise<unknown>) {
  const reloads = listReloads.get(app) ?? new Map<string, ListReload>()
  listReloads.set(app, reloads)
  const running = reloads.get(key)
  if (running) {
    if (version > running.version) {
      running.version = version
      running.again = true
    }
    return
  }
  const state = { version, again: false }
  reloads.set(key, state)
  const run = () => {
    void reload()
      .catch(() => {})
      .finally(() => {
        if (!state.again) {
          reloads.delete(key)
          return
        }
        state.again = false
        run()
      })
  }
  run()
}

/** Returns a paginated file list with sorting, filtering, and infinite scroll support. */
export function useFileList(params: FileListParams) {
  const app = useApp()
  const {
    scope,
    sortBy = 'DATE',
    sortDir: sortDirParam,
    categories = [],
    query,
    tags = [],
    directoryId,
  } = params
  const sortingDir = sortDirParam ?? (sortBy === 'NAME' ? 'ASC' : 'DESC')

  const categoriesKey = categories.length ? categories.slice().sort().join(',') : ''

  const tagsKey = tags.length ? tags.slice().sort().join(',') : ''

  const base = `library/${scope}:list:${sortBy}:${sortingDir}:${categoriesKey}:${tagsKey}:${directoryId ?? ''}:${query ?? ''}`

  const fetcher = async (key: string) => {
    const pageIndex = Number(key.split('|page=').pop() ?? '0')
    const since = { tags: app.caches.tags.mark(), fsFileUri: app.caches.fsFileUri.mark() }
    const rows = await app.files.queryLibrary({
      sortBy,
      sortDir: sortingDir,
      categories: categories.length ? categories : undefined,
      query: query?.trim().length ? query : undefined,
      tags: tags.length ? tags : undefined,
      directoryId,
      limit: PAGE_SIZE,
      offset: pageIndex * PAGE_SIZE,
    })

    primeListRowCaches(app, rows, since)

    const fileIds = rows.map((r) => r.id)
    const objectsByFile = await app.localObjects.getRefsForFiles(fileIds)
    return rows.map((row) => transformRow(row, objectsByFile[row.id]))
  }

  const getKey = (pageIndex: number, prevPage: FileRecord[] | null) => {
    if (pageIndex > 0 && (!prevPage || prevPage.length < PAGE_SIZE)) return null
    return `${base}|page=${pageIndex}`
  }
  const swr = useSWRInfinite<FileRecord[]>(getKey, fetcher, {
    revalidateOnFocus: false,
    revalidateAll: true,
  })

  // Reloads by the list's own key through the global mutate. The hook's
  // swr.mutate() reloads whichever list the hook shows when it runs, and a
  // reload queued for this list can run after that hook has switched its sort
  // or search, or unmounted.
  const { mutate } = useSWRConfig()
  const listKey = unstable_serialize(getKey)
  useOnLibraryListChange((version) => reloadList(app, listKey, version, () => mutate(listKey)))

  const pages = swr.data

  const flat = useMemo(() => {
    return pages ? pages.flat() : undefined
  }, [pages])

  const lastPage = pages?.[pages.length - 1]
  const hasMore = !!lastPage && lastPage.length === PAGE_SIZE
  // A page requested and not yet loaded, while a load runs. isValidating
  // alone also holds through every reload of the loaded pages, which a
  // library change starts, so a busy library kept the spinner at the end of
  // the list up. The page count alone stays short after a failed load, and
  // a load that fails while SWR is paused (the mobile app pauses it in the
  // background) sets no error either, so the spinner would stay up and the
  // list would never ask for the page again.
  const isLoadingMore = hasMore && !!pages && pages.length < swr.size && swr.isValidating

  return {
    ...swr,
    data: flat,
    hasMore,
    isLoadingMore,
  }
}

/**
 * Returns a stable `loadMore` callback and `isLoadingMore` flag from
 * `useFileList` pagination state. Call `loadMore` when the user scrolls
 * near the end of the list (e.g. IntersectionObserver, FlatList onEndReached).
 */
export function useLoadMore(pagination: {
  hasMore: boolean
  isLoadingMore: boolean
  size: number
  setSize: (size: number | ((_size: number) => number)) => unknown
}) {
  const { hasMore, isLoadingMore, size, setSize } = pagination

  const loadMore = useCallback(() => {
    if (!isLoadingMore && hasMore) {
      setSize(size + 1)
    }
  }, [isLoadingMore, hasMore, setSize, size])

  return { loadMore, isLoadingMore }
}

/** Returns the total number of non-thumbnail files in the library. */
export function useLibraryCount() {
  const app = useApp()
  return useSWR(app.caches.library.key('countNoThumbs'), () => app.library.fileCount())
}

/** Returns the total number of media (photo/video) files in the library. */
export function useMediaCount() {
  const app = useApp()
  return useSWR(app.caches.library.key('mediaCount'), () => app.library.mediaCount())
}

/** Returns the number of files associated with a given tag. */
export function useTagFileCount(tagId: string) {
  const app = useApp()
  return useSWR(app.caches.library.key(`tagCount:${tagId}`), () => app.library.tagFileCount(tagId))
}

/** Returns the number of files in a given directory. */
export function useDirectoryFileCount(directoryId: string) {
  const app = useApp()
  return useSWR(app.caches.library.key(`dirCount:${directoryId}`), () =>
    app.library.directoryFileCount(directoryId),
  )
}

/** Returns the number of files not assigned to any directory. */
export function useUnfiledFileCount() {
  const app = useApp()
  return useSWR(app.caches.library.key('unfiledCount'), () => app.library.unfiledFileCount())
}
