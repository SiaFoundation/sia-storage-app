import type { ObjectsCursor } from '@siastorage/core/adapters'
import type { SyncUpCursor } from '@siastorage/core/services/syncUpMetadata'

type StorageAdapter = {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  deleteItem(key: string): Promise<void>
}

export function buildCursorDeps(storage: StorageAdapter) {
  async function getSyncDownCursor(): Promise<ObjectsCursor | undefined> {
    const raw = await storage.getItem('syncDownCursor')
    if (!raw) return undefined
    const parsed = JSON.parse(raw)
    return { id: parsed.id, after: new Date(parsed.after) }
  }

  async function setSyncDownCursor(
    cursor: ObjectsCursor | undefined,
  ): Promise<void> {
    if (!cursor) {
      await storage.deleteItem('syncDownCursor')
    } else {
      await storage.setItem(
        'syncDownCursor',
        JSON.stringify({ id: cursor.id, after: cursor.after.getTime() }),
      )
    }
  }

  async function getSyncUpCursor(): Promise<SyncUpCursor | undefined> {
    const raw = await storage.getItem('syncUpCursor')
    if (!raw) return undefined
    return JSON.parse(raw)
  }

  async function setSyncUpCursor(
    cursor: SyncUpCursor | undefined,
  ): Promise<void> {
    if (!cursor) {
      await storage.deleteItem('syncUpCursor')
    } else {
      await storage.setItem('syncUpCursor', JSON.stringify(cursor))
    }
  }

  return {
    getSyncDownCursor,
    setSyncDownCursor,
    getSyncUpCursor,
    setSyncUpCursor,
  }
}
