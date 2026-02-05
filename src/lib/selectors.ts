import useSWR, { type SWRConfiguration, type SWRResponse } from 'swr'
import type { StoreApi, UseBoundStore } from 'zustand'
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
export function createGetterAndSWRHook<T, Args extends any[] = []>(
  key: string[],
  fetcher: (...args: Args) => Promise<T>,
): [
  (...args: Args) => Promise<T>,
  (...args: [...Args, SWRConfiguration?]) => SWRResponse<T, any, any>,
] {
  const argCount = fetcher.length
  return [
    (...args: Args) => fetcher(...args),
    (...argsAndConfig: [...Args, SWRConfiguration?]) => {
      const args = argsAndConfig.slice(0, argCount) as unknown as Args
      const config = argsAndConfig[argCount] as SWRConfiguration | undefined
      return useSWR([...key, ...args], () => fetcher(...args), config)
    },
  ]
}
