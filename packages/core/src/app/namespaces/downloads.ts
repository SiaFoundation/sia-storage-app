import type { DatabaseAdapter } from '../../adapters/db'
import type { SdkAdapter } from '../../adapters/sdk'
import type { StorageAdapter } from '../../adapters/storage'
import { DEFAULT_MAX_DOWNLOADS } from '../../config'
import * as ops from '../../db/operations'
import type { LocalObject } from '../../encoding/localObject'
import { SlotPool } from '../../lib/slotPool'
import type { FsIOAdapter } from '../../services/fsFileUri'
import type { AppCaches, AppService } from '../service'
import type { DownloadsState } from '../stores'

/** Platform-specific download implementation. Handles streaming download to local storage. */
export type DownloadObjectAdapter = {
  download(params: {
    file: { id: string; type: string; size: number }
    object: LocalObject
    sdk: SdkAdapter
    onProgress: (progress: number) => void
    signal: AbortSignal
  }): Promise<void>
}

/** Builds the downloads namespace: queue, track, cancel, and download files. */
export function buildDownloadsNamespace(
  db: DatabaseAdapter,
  fsIO: FsIOAdapter,
  downloadObject: DownloadObjectAdapter,
  storage: StorageAdapter,
  caches: AppCaches,
  getSdk: () => SdkAdapter | null,
): AppService['downloads'] {
  let state: DownloadsState = { downloads: {} }
  const controllers = new Map<string, AbortController>()
  const slotPool = new SlotPool(DEFAULT_MAX_DOWNLOADS)
  const inFlight = new Map<string, Promise<void>>()
  const slotReleases = new Map<string, () => void>()
  let slotTokenCounter = 0

  function register(id: string) {
    const controller = new AbortController()
    controllers.set(id, controller)
    state = {
      downloads: {
        ...state.downloads,
        [id]: { id, status: 'queued', progress: 0 },
      },
    }
    caches.downloads.invalidate('counts')
    caches.downloads.invalidate(id)
  }

  function update(
    id: string,
    patch: Partial<DownloadsState['downloads'][string]>,
  ) {
    const existing = state.downloads[id]
    if (!existing) return
    state = {
      downloads: { ...state.downloads, [id]: { ...existing, ...patch } },
    }
    caches.downloads.invalidate(id)
  }

  function remove(id: string) {
    controllers.delete(id)
    inFlight.delete(id)
    const { [id]: _, ...rest } = state.downloads
    state = { downloads: rest }
    caches.downloads.invalidate('counts')
    caches.downloads.invalidate(id)
  }

  async function execute(fileId: string): Promise<void> {
    const file = await ops.readFileRecord(db, fileId)
    if (!file) throw new Error('File record not found')

    const { value: size } = await fsIO.size(fileId, file.type)
    if (size !== null) return

    const sdk = getSdk()
    if (!sdk) throw new Error('SDK not initialized')
    const objects = await ops.queryLocalObjectsForFile(db, fileId)
    if (!objects.length) throw new Error('No object available for download')

    register(fileId)
    const release = await slotPool.acquire()
    try {
      update(fileId, { status: 'downloading' })

      const controller = controllers.get(fileId)
      if (!controller) throw new Error('No controller for download')

      await downloadObject.download({
        file: { id: fileId, type: file.type, size: file.size },
        object: objects[0],
        sdk,
        onProgress: (progress) =>
          update(fileId, { progress: Math.min(1, progress) }),
        signal: controller.signal,
      })

      if (controller.signal.aborted) return

      await ops.upsertFsFileMetadata(db, {
        fileId,
        size: file.size,
        addedAt: Date.now(),
        usedAt: Date.now(),
      })
      update(fileId, { status: 'done', progress: 1 })
    } catch (e) {
      const controller = controllers.get(fileId)
      if (!controller?.signal.aborted) {
        const message = e instanceof Error ? e.message : String(e)
        update(fileId, { status: 'error', error: message })
      }
      throw e
    } finally {
      release()
      inFlight.delete(fileId)
    }
  }

  return {
    getState: () => ({ ...state }),
    getEntry: (id) => state.downloads[id],
    register: (id) => register(id),
    update: (id, patch) => update(id, patch),
    remove: (id) => remove(id),
    acquireSlot: async () => {
      const release = await slotPool.acquire()
      const token = String(++slotTokenCounter)
      slotReleases.set(token, release)
      return token
    },
    releaseSlot: (token) => {
      const release = slotReleases.get(token)
      if (release) {
        release()
        slotReleases.delete(token)
      }
    },
    downloadFile: (fileId) => {
      const existing = inFlight.get(fileId)
      if (existing) return existing
      const promise = execute(fileId).finally(() => {
        inFlight.delete(fileId)
      })
      inFlight.set(fileId, promise)
      return promise
    },
    cancel: (id) => {
      const controller = controllers.get(id)
      if (controller) {
        controller.abort()
        controllers.delete(id)
      }
      inFlight.delete(id)
      const { [id]: _, ...rest } = state.downloads
      state = { downloads: rest }
      caches.downloads.invalidate('counts')
      caches.downloads.invalidate(id)
    },
    cancelAll: () => {
      for (const controller of controllers.values()) {
        controller.abort()
      }
      controllers.clear()
      inFlight.clear()
      state = { downloads: {} }
      caches.downloads.invalidateAll()
    },
    setMaxSlots: async (n) => {
      const clamped = Math.max(1, Math.floor(Number(n) || 1))
      await storage.setItem('maxDownloads', String(clamped))
      caches.settings.invalidate('maxDownloads')
      slotPool.setMaxSlots(clamped)
    },
  }
}
