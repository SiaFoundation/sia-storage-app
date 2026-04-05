/**
 * In-memory mock for @react-native-async-storage/async-storage.
 */

const store = new Map<string, string>()

const AsyncStorage = {
  getItem: async (key: string): Promise<string | null> => {
    return store.get(key) ?? null
  },

  setItem: async (key: string, value: string): Promise<void> => {
    store.set(key, value)
  },

  removeItem: async (key: string): Promise<void> => {
    store.delete(key)
  },

  mergeItem: async (key: string, value: string): Promise<void> => {
    const existing = store.get(key)
    if (existing) {
      const merged = { ...JSON.parse(existing), ...JSON.parse(value) }
      store.set(key, JSON.stringify(merged))
    } else {
      store.set(key, value)
    }
  },

  clear: async (): Promise<void> => {
    store.clear()
  },

  getAllKeys: async (): Promise<readonly string[]> => {
    return Array.from(store.keys())
  },

  multiGet: async (keys: readonly string[]): Promise<readonly [string, string | null][]> => {
    return keys.map((key) => [key, store.get(key) ?? null])
  },

  multiSet: async (keyValuePairs: readonly [string, string][]): Promise<void> => {
    for (const [key, value] of keyValuePairs) {
      store.set(key, value)
    }
  },

  multiRemove: async (keys: readonly string[]): Promise<void> => {
    for (const key of keys) {
      store.delete(key)
    }
  },

  multiMerge: async (keyValuePairs: readonly [string, string][]): Promise<void> => {
    for (const [key, value] of keyValuePairs) {
      await AsyncStorage.mergeItem(key, value)
    }
  },

  flushGetRequests: (): void => {
    // No-op in mock
  },
}

export function clearStore(): void {
  store.clear()
}

export function getStoreSnapshot(): Map<string, string> {
  return new Map(store)
}

export default AsyncStorage
