import useSWR from 'swr'
import { useApp } from '../app/context'

/** Fetches all user-created directories. */
export function useAllDirectories() {
  const app = useApp()
  return useSWR(app.caches.directories.key('all'), () =>
    app.directories.getAll(),
  )
}

/** Fetches the directory name associated with a given file, if any. */
export function useDirectoryForFile(fileId: string | null) {
  const app = useApp()
  return useSWR(
    fileId ? app.caches.directories.key(`file/${fileId}`) : null,
    () => (fileId ? app.directories.getNameForFile(fileId) : undefined),
  )
}
