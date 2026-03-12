import { createDebouncedAction } from '@siastorage/core/lib/debouncedAction'
import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { swrCacheBy } from '../lib/swr'

/** Library stat queries (count, stats, localOnly, etc.), keyed by stat name. invalidateAll() clears them together. */
export const libraryStats = swrCacheBy()

const INVALIDATION_DEBOUNCE_MS = 200

const statsFlusher = createDebouncedAction(
  () => libraryStats.invalidateAll(),
  INVALIDATION_DEBOUNCE_MS,
)
export const invalidateCacheLibraryAllStats = statsFlusher.trigger

// Version counter for signaling library list changes. Subscribers use
// useOnLibraryListChange to run a callback when the version bumps.
type LibraryVersionState = { version: number }

const useLibraryVersion = create<LibraryVersionState>(() => ({
  version: 0,
}))

const listsFlusher = createDebouncedAction(
  () => useLibraryVersion.setState((s) => ({ version: s.version + 1 })),
  INVALIDATION_DEBOUNCE_MS,
)
export const invalidateCacheLibraryLists = listsFlusher.trigger

/** Runs `callback` whenever the library list version bumps. */
export function useOnLibraryListChange(callback: () => void) {
  const { version } = useLibraryVersion()
  const versionRef = useRef(version)
  const callbackRef = useRef(callback)
  callbackRef.current = callback
  useEffect(() => {
    if (version === versionRef.current) return
    versionRef.current = version
    callbackRef.current()
  }, [version])
}
