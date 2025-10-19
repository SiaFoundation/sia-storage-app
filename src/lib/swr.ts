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
  const changeCallbacks = new Map<string, () => void>()

  const addChangeCallback = (key: string, callback: () => void) => {
    changeCallbacks.set(key, callback)
  }

  const removeChangeCallback = (key: string) => {
    changeCallbacks.delete(key)
  }

  const getKey = (id?: string) => {
    return id ? [`${baseKey}/${id}`] : [`${baseKey}`]
  }

  const triggerChange = async (keyPath?: string) => {
    await mutate((key: string[]) => {
      if (!Array.isArray(key) || typeof key[0] !== 'string') {
        return false
      }
      const first = key[0]
      return first.startsWith(getKey(keyPath)[0])
    })
    changeCallbacks.forEach((callback) => callback())
  }

  return {
    getKey,
    triggerChange,
    addChangeCallback,
    removeChangeCallback,
  }
}
