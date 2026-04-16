import type { StorageAdapter } from '@siastorage/core/adapters'
import * as fs from 'fs'
import * as path from 'path'

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

export function createJsonFileStorage(filePath: string, opts?: { mode?: number }): StorageAdapter {
  const mode = opts?.mode ?? 0o644
  let cache: Record<string, string>

  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    cache = JSON.parse(raw)
    if (typeof cache !== 'object' || cache === null || Array.isArray(cache)) {
      cache = {}
    }
  } catch {
    cache = {}
  }

  function persist(): void {
    const dir = path.dirname(filePath)
    fs.mkdirSync(dir, { recursive: true })
    // Write to a temp file then atomically rename so a crash mid-write
    // can never leave a half-written or empty file in place.
    const tmpPath = `${filePath}.${process.pid}.tmp`
    fs.writeFileSync(tmpPath, JSON.stringify(cache, null, 2), { mode })
    fs.renameSync(tmpPath, filePath)
  }

  return {
    async getItem(key: string): Promise<string | null> {
      return cache[key] ?? null
    },
    async setItem(key: string, value: string): Promise<void> {
      cache[key] = value
      persist()
    },
    async deleteItem(key: string): Promise<void> {
      delete cache[key]
      persist()
    },
  }
}
