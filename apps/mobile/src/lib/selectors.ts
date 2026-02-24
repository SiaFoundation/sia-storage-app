import useSWR, { type SWRConfiguration, type SWRResponse } from 'swr'
import type { StoreApi, UseBoundStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { type SwrCache, swrCache } from './swr'

/**
 * Creates getter and hook selectors for a state transform function.
 * @param useStore - The zustand store.
 * @param transform - The transform function.
 * @returns [getData, useData]
 *
 * Example:
 * ```ts
 * const [getCount, useCount] = createGetterAndSelector(
 *   useTransfersStore,
 *   (state) => ({
 *     count: state.length,
 *   })
 * )
 * ```
 */
export function createGetterAndSelector<T, R, Args extends any[] = []>(
  useStore: UseBoundStore<StoreApi<T>>,
  transform: (state: T, ...args: Args) => R,
): [(...args: Args) => R, (...args: Args) => R] {
  return [
    (...args: Args) => transform(useStore.getState(), ...args),
    (...args: Args) =>
      useStore(useShallow((state) => transform(state, ...args))),
  ]
}

/**
 * Creates a getter function, SWR hook, and cache entry for async data.
 *
 * Standalone (creates its own cache):
 *   const [get, use, cache] = createGetterAndSWRHook(fetcher)
 *
 * With external key (for shared caches like libraryStats):
 *   const [get, use] = createGetterAndSWRHook(sharedCache.key('x'), fetcher)
 */
export function createGetterAndSWRHook<T, Args extends any[] = []>(
  fetcher: (...args: Args) => Promise<T>,
): [
  (...args: Args) => Promise<T>,
  (...args: [...Args, SWRConfiguration?]) => SWRResponse<T, any, any>,
  SwrCache<T>,
]
export function createGetterAndSWRHook<T, Args extends any[] = []>(
  key: string[],
  fetcher: (...args: Args) => Promise<T>,
): [
  (...args: Args) => Promise<T>,
  (...args: [...Args, SWRConfiguration?]) => SWRResponse<T, any, any>,
]
export function createGetterAndSWRHook<T, Args extends any[] = []>(
  keyOrFetcher: string[] | ((...args: Args) => Promise<T>),
  maybeFetcher?: (...args: Args) => Promise<T>,
) {
  let key: string[]
  let fetcher: (...args: Args) => Promise<T>
  let cache: SwrCache<T> | undefined

  if (Array.isArray(keyOrFetcher)) {
    key = keyOrFetcher
    fetcher = maybeFetcher!
  } else {
    cache = swrCache<T>()
    key = cache.key()
    fetcher = keyOrFetcher
  }

  const argCount = fetcher.length
  const result: [
    (...args: Args) => Promise<T>,
    (...args: [...Args, SWRConfiguration?]) => SWRResponse<T, any, any>,
    SwrCache<T>?,
  ] = [
    (...args: Args) => fetcher(...args),
    (...argsAndConfig: [...Args, SWRConfiguration?]) => {
      const args = argsAndConfig.slice(0, argCount) as unknown as Args
      const config = argsAndConfig[argCount] as SWRConfiguration | undefined
      return useSWR([...key, ...args], () => fetcher(...args), config)
    },
  ]

  if (cache) result.push(cache)
  return result
}
