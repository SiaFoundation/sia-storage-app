import type { LibraryVersionCache } from './service'

/** Creates a version counter that notifies subscribers on each invalidation. */
export function createLibraryVersionCache(): LibraryVersionCache {
  let version = 0
  const listeners = new Set<() => void>()
  return {
    invalidate() {
      version++
      for (const l of listeners) l()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getVersion() {
      return version
    },
  }
}
