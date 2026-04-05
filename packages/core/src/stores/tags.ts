import useSWR from 'swr'
import { useApp } from '../app/context'

/** Fetches all user-created tags. */
export function useAllTags() {
  const app = useApp()
  return useSWR(app.caches.tags.key('all'), () => app.tags.getAll())
}

/** Fetches all tags associated with a given file. */
export function useTagsForFile(fileId: string | null) {
  const app = useApp()
  return useSWR(fileId ? app.caches.tags.key(`file/${fileId}`) : null, () =>
    fileId ? app.tags.getForFile(fileId) : [],
  )
}

/** Searches tags by a text query and returns matching results. */
export function useTagSearch(query: string) {
  const app = useApp()
  return useSWR(app.caches.tags.key(`search/${query}`), () => app.tags.search(query))
}

/** Returns whether a given file is marked as a favorite. */
export function useIsFavorite(fileId: string | null) {
  const app = useApp()
  return useSWR(fileId ? app.caches.tags.key(`favorite/${fileId}`) : null, () =>
    fileId ? app.tags.isFavorite(fileId) : false,
  )
}
