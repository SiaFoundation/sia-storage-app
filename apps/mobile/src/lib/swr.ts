import { mutate } from 'swr'

let nextId = 0

export type SwrCache<T = unknown> = ReturnType<typeof swrCache<T>>

/**
 * SWR cache entry with no parameters.
 *
 *   const allHostsCache = swrCache()
 *   useSWR(allHostsCache.key(), fetcher)
 *   allHostsCache.invalidate()
 *   allHostsCache.set(newData)
 */
export function swrCache<T = unknown>() {
  const key = [`swr/${nextId++}`]
  return {
    key: () => key,
    invalidate: () => mutate(key),
    set: (data: T) => mutate(key, data ?? undefined, { revalidate: false }),
  }
}

/**
 * SWR cache entry parameterized by one or more string key parts.
 *
 *   const hostByKeyCache = swrCacheBy()
 *   useSWR(hostByKeyCache.key(publicKey), fetcher)
 *   hostByKeyCache.invalidate(publicKey)
 *   hostByKeyCache.set(newData, publicKey)
 *   hostByKeyCache.invalidateAll()
 */
export function swrCacheBy<T = unknown>() {
  const prefix = `swr/${nextId++}`
  return {
    key: (...parts: string[]) => [`${prefix}/${parts.join('/')}`],
    invalidate: (...parts: string[]) =>
      mutate([`${prefix}/${parts.join('/')}`]),
    invalidateAll: () =>
      mutate(
        (key: unknown) =>
          Array.isArray(key) &&
          typeof key[0] === 'string' &&
          key[0].startsWith(`${prefix}/`),
      ),
    set: (data: T, ...parts: string[]) =>
      mutate([`${prefix}/${parts.join('/')}`], data ?? undefined, {
        revalidate: false,
      }),
  }
}
