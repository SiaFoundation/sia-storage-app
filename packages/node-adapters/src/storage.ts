import type { StorageAdapter } from '@siastorage/core/adapters'

export function createInMemoryStorage(): StorageAdapter {
  const store = new Map<string, string>()

  return {
    async getItem(key: string): Promise<string | null> {
      return store.get(key) ?? null
    },
    async setItem(key: string, value: string): Promise<void> {
      store.set(key, value)
    },
    async deleteItem(key: string): Promise<void> {
      store.delete(key)
    },
  }
}
