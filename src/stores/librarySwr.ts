import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { swrCacheBy } from '../lib/swr'

/** Library stat queries (count, stats, localOnly, etc.), keyed by stat name. invalidateAll() clears them together. */
export const libraryStats = swrCacheBy()

export const invalidateCacheLibraryAllStats = () => libraryStats.invalidateAll()

// Version counter for signaling library list changes. Subscribers use
// useOnLibraryListChange to run a callback when the version bumps.
type LibraryVersionState = { version: number }

const useLibraryVersion = create<LibraryVersionState>(() => ({
  version: 0,
}))

export function invalidateCacheLibraryLists() {
  useLibraryVersion.setState((s) => ({ version: s.version + 1 }))
}

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
