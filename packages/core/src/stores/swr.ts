import useSWR, { mutate } from 'swr'
import { createCoalescer } from '../lib/coalescer'

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
  const coalescers = new Map<string, ReturnType<typeof createCoalescer>>()

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
     * Returns coalesced versions of invalidate/invalidateAll: the first call
     * in a quiet stretch invalidates at once, later calls at most once per
     * `ms`. Call `flush` to force immediate invalidation (e.g. on
     * register/remove).
     */
    coalesced: (ms: number) => {
      function getOrCreate(key: string, fn: () => void) {
        let d = coalescers.get(key)
        if (!d) {
          d = createCoalescer(fn, ms)
          coalescers.set(key, d)
        }
        return d
      }
      return {
        invalidate: (...parts: string[]) =>
          getOrCreate(parts.join('/'), () => cache.invalidate(...parts)).trigger(),
        invalidateAll: () => getOrCreate('*', () => cache.invalidateAll()).trigger(),
        flush: (...parts: string[]) => {
          const key = parts.length ? parts.join('/') : '*'
          const d = coalescers.get(key)
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

/**
 * A `swrCacheBy` that a list query fills for its rows, where a value written
 * after the query began must survive the query's answer.
 *
 * A list query that starts before a download lands and returns after it
 * holds the file's old "not on this device" row. Setting the cache from that
 * row undoes what the download wrote, and the file shows as cloud only until
 * something reads it again. So a reader calls `mark` before its query and
 * `fill` with the answer, and `fill` leaves alone any key that was set,
 * invalidated or filled since the mark. The writer must have committed the
 * database row before it writes here, so a query started after the write
 * reads the new row.
 */
export function swrFillableCacheBy<T = unknown>() {
  const cache = swrCacheBy<T>()
  let writes = 0
  // Every key written since the cache was made, so this holds at most one
  // number per key the app has touched.
  const writtenAt = new Map<string, number>()
  let allWrittenAt = 0

  function written(parts: string[]) {
    writtenAt.set(parts.join('/'), ++writes)
  }

  // No `coalesced`: its invalidations would reach SWR without being recorded,
  // and a query in flight would then fill over them.
  return {
    key: cache.key,
    set: (data: T, ...parts: string[]) => {
      written(parts)
      return cache.set(data, ...parts)
    },
    invalidate: (...parts: string[]) => {
      written(parts)
      return cache.invalidate(...parts)
    },
    invalidateAll: () => {
      allWrittenAt = ++writes
      return cache.invalidateAll()
    },
    /** Taken before a query whose answer is passed to `fill`. */
    mark: () => writes,
    /** Sets the entry unless it was written after `mark` returned `since`. */
    fill: (since: number, data: T, ...parts: string[]) => {
      if (allWrittenAt > since || (writtenAt.get(parts.join('/')) ?? 0) > since) return
      written(parts)
      void cache.set(data, ...parts)
    },
  }
}
