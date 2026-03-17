import { createDebouncedAction } from '@siastorage/core/lib/debouncedAction'
import { swrCacheBy } from '@siastorage/core/stores'

/** Library stat queries (count, stats, localOnly, etc.), keyed by stat name. invalidateAll() clears them together. */
export const libraryStats = swrCacheBy()

const INVALIDATION_DEBOUNCE_MS = 200

const statsFlusher = createDebouncedAction(
  () => libraryStats.invalidateAll(),
  INVALIDATION_DEBOUNCE_MS,
)
export const invalidateCacheLibraryAllStats = statsFlusher.trigger

const listsFlusher = createDebouncedAction(() => {}, INVALIDATION_DEBOUNCE_MS)
export const invalidateCacheLibraryLists = listsFlusher.trigger
