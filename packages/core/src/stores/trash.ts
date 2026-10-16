import useSWR from 'swr'
import { useApp } from '../app/context'

/** Entries a trash list shows at first, and how many more each "Show more" adds. */
export const TRASH_PAGE = 200

/**
 * The first `limit` entries in the trash, one per file with the versions
 * trashed with it. Keyed in the library cache, which every trash, restore and
 * delete clears.
 */
export function useTrashEntries(limit: number = TRASH_PAGE) {
  const app = useApp()
  // Show more raises the limit, which is a new key. Keeping the shorter
  // list until the longer one arrives stops a list from emptying to a
  // loading line and losing its scroll position.
  return useSWR(
    app.caches.library.key('trash', String(limit)),
    () => app.files.trashEntries({ limit }),
    { keepPreviousData: true },
  )
}

/** How many entries the trash holds, which a list showing some of them can fall short of. */
export function useTrashCount() {
  const app = useApp()
  return useSWR(app.caches.library.key('trash-count'), () => app.files.trashCount())
}
