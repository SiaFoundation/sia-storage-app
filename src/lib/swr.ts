import { mutate } from 'swr'

/**
 * Builds SWR helpers for a given base key.
 *
 * Example:
 * ```
 * const { getKey, triggerChange } = buildSWRHelpers('key')
 * ```
 */
export function buildSWRHelpers(baseKey: string) {
  const getKey = (id?: string) => {
    return id ? `${baseKey}/${id}` : `${baseKey}`
  }
  const triggerChange = async (keyPath?: string) => {
    await mutate((key: string) => {
      return typeof key === 'string' && key.startsWith(getKey(keyPath))
    })
  }
  return {
    getKey,
    triggerChange,
  }
}
