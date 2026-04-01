import useSWR, { mutate } from 'swr'
import { createDebouncedAction } from '../lib/debouncedAction'

let nextId = 0

/** A single-key SWR cache with invalidate and set operations. */
export type SwrCache<T = unknown> = ReturnType<typeof swrCache<T>>
/** A multi-key SWR cache that supports keyed invalidation and bulk invalidation. */
export type SwrCacheBy<T = unknown> = ReturnType<typeof swrCacheBy<T>>
/** A reactive state container backed by SWR with get, set, and hook access. */
export type SwrState<T> = ReturnType<typeof swrState<T>>

/** Creates a single-key SWR cache with invalidation and direct-set support. */
export function swrCache<T = unknown>() {
  const key = [`swr/${nextId++}`]
  return {
    key: () => key,
    invalidate: () => mutate(key),
    set: (data: T) => mutate(key, data ?? undefined, { revalidate: false }),
  }
}

/** Creates a reactive state container that exposes get/set and a SWR-backed React hook. */
export function swrState<T>(initial: T) {
  const cache = swrCacheBy()
  let state = initial
  return {
    getState: () => state,
    setState: (next: T) => {
      state = next
      cache.invalidateAll()
    },
    useValue: <R>(selector: (s: T) => R, ...key: string[]): R => {
      const { data } = useSWR(cache.key(...key), () => selector(state))
      return data ?? selector(initial)
    },
    cache,
  }
}

/** Creates a prefix-scoped SWR cache supporting keyed and bulk invalidation. */
export function swrCacheBy<T = unknown>() {
  const prefix = `swr/${nextId++}`
  const debouncers = new Map<string, ReturnType<typeof createDebouncedAction>>()

  const cache = {
    key: (...parts: string[]) => [`${prefix}/${parts.join('/')}`],
    invalidate: (...parts: string[]) => mutate([`${prefix}/${parts.join('/')}`]),
    invalidateAll: () =>
      mutate(
        (key: unknown) =>
          Array.isArray(key) && typeof key[0] === 'string' && key[0].startsWith(`${prefix}/`),
      ),
    set: (data: T, ...parts: string[]) =>
      mutate([`${prefix}/${parts.join('/')}`], data ?? undefined, {
        revalidate: false,
      }),
    /**
     * Returns debounced versions of invalidate/invalidateAll.
     * Multiple calls within `ms` coalesce into a single invalidation.
     * Call `flush` to force immediate invalidation (e.g. on register/remove).
     */
    debounced: (ms: number) => {
      function getOrCreate(key: string, fn: () => void) {
        let d = debouncers.get(key)
        if (!d) {
          d = createDebouncedAction(fn, ms)
          debouncers.set(key, d)
        }
        return d
      }
      return {
        invalidate: (...parts: string[]) =>
          getOrCreate(parts.join('/'), () => cache.invalidate(...parts)).trigger(),
        invalidateAll: () => getOrCreate('*', () => cache.invalidateAll()).trigger(),
        flush: (...parts: string[]) => {
          const key = parts.length ? parts.join('/') : '*'
          const d = debouncers.get(key)
          if (d) {
            d.flush()
            return
          }
          if (parts.length) cache.invalidate(...parts)
          else cache.invalidateAll()
        },
      }
    },
  }
  return cache
}
