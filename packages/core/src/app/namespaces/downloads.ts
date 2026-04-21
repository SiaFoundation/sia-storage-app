import type { DatabaseAdapter } from '../../adapters/db'
import type { SdkAdapter } from '../../adapters/sdk'
import type { StorageAdapter } from '../../adapters/storage'
import { DEFAULT_MAX_DOWNLOADS, MAX_AUTO_DOWNLOAD_QUEUE } from '../../config'
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
  /** Resolves a share URL via the SDK and streams its contents to local storage. */
  downloadFromShareUrl(params: {
    file: { id: string; type: string }
    url: string
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

  function update(id: string, patch: Partial<DownloadsState['downloads'][string]>) {
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

  async function execute(fileId: string, priority = 1): Promise<void> {
    // Caller (downloadFile) registers synchronously before awaiting, so the
    // controller is guaranteed to exist here. Capturing it first means a
    // cancel() arriving during any await below properly aborts this run.
    const controller = controllers.get(fileId)!
    let release: (() => void) | undefined
    try {
      const file = await ops.readFile(db, fileId)
      if (!file) throw new Error('File record not found')

      const { value: size } = await fsIO.size(fileId, file.type)
      if (size !== null) {
        remove(fileId)
        return
      }

      const sdk = getSdk()
      if (!sdk) throw new Error('SDK not initialized')
      const objects = await ops.queryObjectsForFile(db, fileId)
      if (!objects.length) throw new Error('No object available for download')

      release = await slotPool.acquire(controller.signal, {
        priority,
        maxQueueDepth: priority === 1 ? MAX_AUTO_DOWNLOAD_QUEUE : undefined,
      })
      update(fileId, { status: 'downloading' })

      await downloadObject.download({
        file: { id: fileId, type: file.type, size: file.size },
        object: objects[0],
        sdk,
        onProgress: (progress) => update(fileId, { progress: Math.min(1, progress) }),
        signal: controller.signal,
      })

      if (controller.signal.aborted) return

      await ops.upsertFsMeta(db, {
        fileId,
        size: file.size,
        addedAt: Date.now(),
        usedAt: Date.now(),
      })
      update(fileId, { status: 'done', progress: 1 })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        return
      }
      if (!controller.signal.aborted) {
        const message = e instanceof Error ? e.message : String(e)
        update(fileId, { status: 'error', error: message })
      }
      throw e
    } finally {
      release?.()
      inFlight.delete(fileId)
    }
  }

  async function executeShareUrl(id: string, url: string): Promise<void> {
    // Caller (downloadFromShareUrl) registers synchronously before awaiting.
    const controller = controllers.get(id)!
    let release: (() => void) | undefined
    try {
      const sdk = getSdk()
      if (!sdk) throw new Error('SDK not initialized')

      release = await slotPool.acquire(controller.signal)
      update(id, { status: 'downloading' })

      await downloadObject.downloadFromShareUrl({
        file: { id, type: 'application/octet-stream' },
        url,
        sdk,
        onProgress: (progress) => update(id, { progress: Math.min(1, progress) }),
        signal: controller.signal,
      })

      if (controller.signal.aborted) return
      remove(id)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        return
      }
      if (!controller.signal.aborted) {
        const message = e instanceof Error ? e.message : String(e)
        update(id, { status: 'error', error: message })
      }
      throw e
    } finally {
      release?.()
      inFlight.delete(id)
    }
  }

  return {
    getState: () => ({ ...state }),
    getEntry: (id) => state.downloads[id],
    downloadFile: (fileId, priority) => {
      const existing = inFlight.get(fileId)
      if (existing) return existing
      register(fileId)
      const promise = execute(fileId, priority).finally(() => {
        inFlight.delete(fileId)
      })
      inFlight.set(fileId, promise)
      return promise
    },
    downloadFromShareUrl: (id, url) => {
      const existing = inFlight.get(id)
      if (existing) return existing
      register(id)
      const promise = executeShareUrl(id, url).finally(() => {
        inFlight.delete(id)
      })
      inFlight.set(id, promise)
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
