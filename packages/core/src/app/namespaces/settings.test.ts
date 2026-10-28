import type { StorageAdapter } from '../../adapters/storage'
import type { AppCaches } from '../service'
import { buildSettingsNamespace } from './settings'

function memoryStorage(): StorageAdapter {
  const items = new Map<string, string>()
  return {
    getItem: async (key) => items.get(key) ?? null,
    setItem: async (key, value) => {
      items.set(key, value)
    },
    deleteItem: async (key) => {
      items.delete(key)
    },
  }
}

const caches = { settings: { invalidate: () => {} } } as unknown as AppCaches

describe('setIndexerURL', () => {
  it('keeps the previous URL when the change callback fails, and runs it again on a retry', async () => {
    let calls = 0
    let failNext = false
    const settings = buildSettingsNamespace(memoryStorage(), caches, async () => {
      calls++
      if (failNext) {
        failNext = false
        throw new Error('database suspended')
      }
    })
    await settings.setIndexerURL('https://first.indexer')
    calls = 0
    failNext = true

    await expect(settings.setIndexerURL('https://next.indexer')).rejects.toThrow(
      'database suspended',
    )
    expect(await settings.getIndexerURL()).toBe('https://first.indexer')

    await settings.setIndexerURL('https://next.indexer')
    expect(calls).toBe(2)
    expect(await settings.getIndexerURL()).toBe('https://next.indexer')
  })

  it('does not run the callback when the URL is unchanged', async () => {
    let calls = 0
    const settings = buildSettingsNamespace(memoryStorage(), caches, async () => {
      calls++
    })
    await settings.setIndexerURL('https://same.indexer')
    await settings.setIndexerURL('https://same.indexer')

    expect(calls).toBe(1)
  })
})
