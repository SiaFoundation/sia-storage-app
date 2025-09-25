import { SWRResponse } from 'swr'
import useSWR from 'swr'
import { StoreApi, UseBoundStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'

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
export function createGetterAndSelector<T, R>(
  useStore: UseBoundStore<StoreApi<T>>,
  transform: (state: T) => R
): [() => R, () => R] {
  return [
    () => transform(useStore.getState()),
    () => useStore(useShallow((state) => transform(state))),
  ]
}

/**
 * Creates getter and swr hook selectors for a state transform function.
 * @param key - The key to use for the selector.
 * @param fetcher - The fetcher function.
 * @returns [getData, useData]
 *
 * Example:
 * ```
 * const [getFileList, useFileList] = createGetterAndSWRHook(
 *   'key',
 *   (data) => data
 * )
 * ```
 */
export function createGetterAndSWRHook<T>(
  key: string,
  fetcher: () => Promise<T>
): [() => Promise<T>, () => SWRResponse<T, any, any>] {
  return [() => fetcher(), () => useSWR(key, () => fetcher())]
}
