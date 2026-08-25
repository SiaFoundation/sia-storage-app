import type { DatabaseAdapter } from '../../adapters/db'
import type { SdkAdapter } from '../../adapters/sdk'
import type { StorageAdapter } from '../../adapters/storage'
import {
  DEFAULT_MAX_DOWNLOADS,
  DOWNLOAD_PRESERVED_DISK_BYTES,
  INSUFFICIENT_SPACE_MESSAGE,
  MAX_AUTO_DOWNLOAD_QUEUE,
} from '../../config'
import * as ops from '../../db/operations'
import type { LocalObject } from '../../encoding/localObject'
import {
  getErrorMessage,
  InsufficientSpaceError,
  isAbortError,
  isInsufficientSpaceError,
  isSuspendedDbError,
} from '../../lib/errors'
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
  /** Resolves a share URL via the SDK and streams its contents to local storage.
   * The share object's size is only known after the SDK resolves it, so the
   * free-space guard is passed in as `ensureSpace`: the adapter awaits it with
   * the resolved size before streaming, and it throws when there is no room. */
  downloadFromShareUrl(params: {
    file: { id: string; type: string }
    url: string
    sdk: SdkAdapter
    ensureSpace: (size: number) => Promise<void>
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
  // Byte size of each download currently competing for disk, so a second
  // concurrent download counts the first's bytes as already spoken for. Two
  // downloads checking the same free space independently could each pass and
  // together overrun it; DEFAULT_MAX_DOWNLOADS lets two run at once. Keyed by
  // download id, populated once the size is known, cleared when the download
  // finalizes.
  const inFlightSizes = new Map<string, number>()
  // In-flight device-space probe, shared so a burst of checkSpaceFor calls
  // (a grid of thumbnails each auto-downloading) collapses to one native read
  // instead of one per tile. A fresh probe runs once the current one settles.
  let deviceSpaceProbe: Promise<{ freeBytes: number }> | null = null

  function probeDeviceSpace(): Promise<{ freeBytes: number }> {
    if (!fsIO.getDeviceSpace) return Promise.resolve({ freeBytes: Number.MAX_SAFE_INTEGER })
    if (!deviceSpaceProbe) {
      deviceSpaceProbe = fsIO.getDeviceSpace().finally(() => {
        deviceSpaceProbe = null
      })
    }
    return deviceSpaceProbe
  }

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
    inFlightSizes.delete(id)
    const { [id]: _, ...rest } = state.downloads
    state = { downloads: rest }
    caches.downloads.invalidate('counts')
    caches.downloads.invalidate(id)
  }

  // True when the device has room for these files plus the preserved-disk
  // reserve, counting bytes already promised to in-flight downloads so
  // concurrent downloads can't each pass against the same free space.
  // `excludeId` drops one in-flight download from that sum, which the execute()
  // backstop uses to avoid counting the file it is itself checking. Fails open:
  // a missing getDeviceSpace capability or a probe that throws returns true, so
  // a space reading we cannot trust never blocks a download.
  async function checkSpaceFor(sizes: number[], excludeId?: string): Promise<boolean> {
    let freeBytes: number
    try {
      ;({ freeBytes } = await probeDeviceSpace())
    } catch {
      return true
    }
    let inFlightBytes = 0
    for (const [id, size] of inFlightSizes) {
      if (id !== excludeId) inFlightBytes += size
    }
    const requiredBytes = sizes.reduce((sum, n) => sum + n, 0) + DOWNLOAD_PRESERVED_DISK_BYTES
    return freeBytes - inFlightBytes >= requiredBytes
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

      // Record this download's size before the check so a concurrent execute()
      // counts it, then exclude it from its own check. Backstop free-space
      // guard: runs on every download. User-initiated paths already checked up
      // front and bailed with a toast, so reaching here failing means a
      // programmatic caller (the viewer's ensureLocal, auto-download,
      // thumbnails) or free space shifting mid-batch. Throw so an awaiting
      // caller gets the real reason, but the catch below leaves the entry's
      // status alone for this error (no error badge for a background prefetch
      // that simply has no room). Fails open when the platform can't report
      // free space.
      inFlightSizes.set(fileId, file.size)
      if (!(await checkSpaceFor([file.size], fileId))) {
        throw new InsufficientSpaceError(INSUFFICIENT_SPACE_MESSAGE)
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

      // Bytes are on disk; gate so the fsMeta upsert doesn't fast-reject
      // and leave the file invisible to the cache-eviction LRU.
      await db.waitUntilActive?.()
      await ops.upsertFsMeta(db, {
        fileId,
        size: file.size,
        addedAt: Date.now(),
        usedAt: Date.now(),
      })
      update(fileId, { status: 'done', progress: 1 })
    } catch (e) {
      if (isAbortError(e)) return
      if (isSuspendedDbError(e)) {
        // Unlike abort (where cancel() pre-cleans), suspension leaves a
        // stale 'downloading' entry — clear it so the indicator falls
        // back, and rethrow so the caller can retry on resume.
        remove(fileId)
        throw e
      }
      if (isInsufficientSpaceError(e)) {
        // No room is not a file error. Clear the entry so no error badge shows
        // (this only fires for programmatic/auto callers; user paths prechecked
        // and never reach here), but rethrow so an awaiting caller sees why.
        remove(fileId)
        throw e
      }
      if (!controller.signal.aborted) {
        update(fileId, { status: 'error', error: getErrorMessage(e) })
      }
      throw e
    } finally {
      release?.()
      inFlight.delete(fileId)
      inFlightSizes.delete(fileId)
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
        ensureSpace: async (size) => {
          // Reserve before checking (excluding self) so a concurrent download
          // counts these bytes, matching execute(). Cleared in the finally.
          inFlightSizes.set(id, size)
          if (!(await checkSpaceFor([size], id))) {
            throw new InsufficientSpaceError(INSUFFICIENT_SPACE_MESSAGE)
          }
        },
        onProgress: (progress) => update(id, { progress: Math.min(1, progress) }),
        signal: controller.signal,
      })

      if (controller.signal.aborted) return
      remove(id)
    } catch (e) {
      if (isAbortError(e)) return
      if (isSuspendedDbError(e)) {
        // See execute() above — clear the stale entry, rethrow for retry.
        remove(id)
        throw e
      }
      if (isInsufficientSpaceError(e)) {
        remove(id)
        throw e
      }
      if (!controller.signal.aborted) {
        update(id, { status: 'error', error: getErrorMessage(e) })
      }
      throw e
    } finally {
      release?.()
      inFlight.delete(id)
      inFlightSizes.delete(id)
    }
  }

  return {
    getState: () => ({ ...state }),
    getEntry: (id) => state.downloads[id],
    checkSpaceFor,
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
      // Release the reserved bytes now: abort returns before the task settles,
      // so a space check right after a cancel would otherwise still count them.
      inFlightSizes.delete(id)
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
      inFlightSizes.clear()
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
