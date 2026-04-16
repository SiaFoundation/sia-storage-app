import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import useSWR from 'swr'
import useSWRInfinite from 'swr/infinite'
import { useApp } from '../app/context'
import type { LibraryQueryParams, SortBy, SortDir } from '../db/operations'
import { transformRow } from '../db/operations'
import type { FileRecord } from '../types/files'

const PAGE_SIZE = 40

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

/** Invokes a callback whenever the library list version changes. */
export function useOnLibraryListChange(callback: () => void) {
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
    callbackRef.current()
  }, [version])
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

    const fileIds = rows.map((r) => r.id)
    const objectsByFile = await app.localObjects.getRefsForFiles(fileIds)
    return rows.map((row) => transformRow(row, objectsByFile[row.id]))
  }

  const swr = useSWRInfinite<FileRecord[]>(
    (pageIndex, prevPage) => {
      if (pageIndex > 0 && (!prevPage || prevPage.length < PAGE_SIZE)) return null
      return `${base}|page=${pageIndex}`
    },
    fetcher,
    { revalidateOnFocus: false, revalidateAll: true },
  )

  useOnLibraryListChange(() => swr.mutate())

  const pages = swr.data

  const flat = useMemo(() => {
    return pages ? pages.flat() : undefined
  }, [pages])

  const lastPage = pages?.[pages.length - 1]
  const hasMore = !!lastPage && lastPage.length === PAGE_SIZE

  return {
    ...swr,
    data: flat,
    hasMore,
  }
}

/**
 * Returns a stable `loadMore` callback and `isLoadingMore` flag from
 * useSWRInfinite pagination state. Call `loadMore` when the user scrolls
 * near the end of the list (e.g. IntersectionObserver, FlatList onEndReached).
 */
export function useLoadMore(pagination: {
  data: unknown[] | undefined
  hasMore: boolean
  isValidating: boolean
  size: number
  setSize: (size: number | ((_size: number) => number)) => unknown
}) {
  const { data, hasMore, isValidating, size, setSize } = pagination
  const isLoadingMore = !!data && isValidating && hasMore

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
