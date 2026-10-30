import useSWR from 'swr'
import { useApp } from '../app/context'

/** Fetches all user-created directories. */
export function useAllDirectories() {
  const app = useApp()
  return useSWR(app.caches.directories.key('all'), () => app.directories.getAll())
}

/** Fetches direct children of a directory (null for root). */
export function useDirectoryChildren(parentPath: string | null) {
  const app = useApp()
  const cacheKey = parentPath === null ? 'children:root' : `children:path:${parentPath}`
  return useSWR(app.caches.directories.key(cacheKey), () => app.directories.getChildren(parentPath))
}

/** Fetches the directory path associated with a given file, if any. */
export function useDirectoryForFile(fileId: string | null) {
  const app = useApp()
  return useSWR(fileId ? app.caches.directories.key(`file/${fileId}`) : null, () =>
    fileId ? app.directories.getPathForFile(fileId) : undefined,
  )
}

/**
 * Fetches a directory by id. Resolves to null once the directory is gone,
 * deleted here or emptied of its last file here or on another device.
 */
export function useDirectoryById(id: string | null) {
  const app = useApp()
  return useSWR(id ? app.caches.directories.key(`id/${id}`) : null, () =>
    id ? app.directories.getById(id) : null,
  )
}
