import type { DatabaseAdapter } from '../../adapters/db'
import type { SdkAdapter } from '../../adapters/sdk'
import type { StorageAdapter } from '../../adapters/storage'
import {
  DEFAULT_MAX_DOWNLOADS,
  DOWNLOAD_PRESERVED_DISK_BYTES,
  INSUFFICIENT_SPACE_MESSAGE,
  MAX_BACKGROUND_DOWNLOADS_QUEUED,
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
import type { DownloadPriority, DownloadsState } from '../stores'

/** The slot pool serves lower numbers first. */
const SLOT_PRIORITY: Record<DownloadPriority, number> = { user: 0, background: 1 }

/** Platform-specific download implementation. Handles streaming download to local storage. */
export type DownloadObjectAdapter = {
  download(params: {
    file: { id: string; type: string; size: number }
    object: LocalObject
    sdk: SdkAdapter
    onProgress: (progress: number) => void
    signal: AbortSignal
  }): Promise<void>
  /**
   * Streams one byte range of an object straight to an absolute path.
   *
   * Optional: only a host that serves ranges to another process by path needs
   * it. Nothing is recorded in managed storage, because a range is not the
   * file and storing it would make a partial file read as downloaded.
   */
  downloadRangeToPath?(params: {
    object: LocalObject
    sdk: SdkAdapter
    destPath: string
    offset: number
    length: number
    signal: AbortSignal
  }): Promise<number>
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
  // The priority each download in flight waits at. A `user` call for a file
  // already waiting as `background` raises it here and in the slot pool.
  const priorities = new Map<string, DownloadPriority>()
  // Byte size of each download currently competing for disk, so a second
  // concurrent download counts the first's bytes as already spoken for. Two
  // downloads checking the same free space independently could each pass and
  // together overrun it; DEFAULT_MAX_DOWNLOADS lets two run at once. Keyed by
  // download id, populated once the size is known, cleared when the download
  // finalizes.
  const inFlightSizes = new Map<string, number>()
  // Files whose last download the background queue dropped, until a new call
  // for the file or cancelAll. A mounted thumbnail tile asks again after a
  // cancel, such as the cancelAll a suspension makes, but not after a drop,
  // where asking again would drop another tile's download.
  const dropped = new Set<string>()
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
    dropped.delete(id)
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
    priorities.delete(id)
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

  async function execute(fileId: string, requested: DownloadPriority): Promise<void> {
    // Caller (downloadFile) registers synchronously before awaiting, so the
    // controller is guaranteed to exist here. Capturing it first means a
    // cancel() arriving during any await below properly aborts this run.
    const controller = controllers.get(fileId)!
    // A cancel followed by a new call for the same file registers a new
    // controller, and this download must not clear the new one's entries.
    const current = () => controllers.get(fileId) === controller
    let release: (() => void) | undefined
    try {
      const file = await ops.readFile(db, fileId)
      if (!file) throw new Error('File record not found')

      // Complete, not merely present: a file left short would otherwise
      // count as downloaded forever and be served to every reader.
      const { value: size } = await fsIO.size(fileId, file.type)
      // A cancelled download stops here. A reservation made after cancel()
      // cleared this file's would never be cleared and would count against
      // every later space check, and remove() below could clear a newer
      // download's entry.
      if (controller.signal.aborted) return
      if (size === file.size) {
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

      // Read now rather than when the download started: a user call may have
      // raised it during the awaits above, before it had a place in the pool.
      const priority = priorities.get(fileId) ?? requested
      release = await slotPool.acquire(controller.signal, {
        priority: SLOT_PRIORITY[priority],
        maxQueueDepth: priority === 'background' ? MAX_BACKGROUND_DOWNLOADS_QUEUED : undefined,
        key: fileId,
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
      if (isAbortError(e)) {
        // cancel() has already removed a cancelled download's entry. One the
        // background queue dropped still has its controller, and its entry
        // would otherwise stay 'queued', counted in the transfers screen, for
        // the rest of the session.
        if (current()) {
          remove(fileId)
          dropped.add(fileId)
        }
        return
      }
      if (isSuspendedDbError(e)) {
        // Unlike abort (where cancel() pre-cleans), suspension leaves a
        // stale 'downloading' entry — clear it so the indicator falls
        // back, and rethrow so the caller can retry on resume.
        if (current()) remove(fileId)
        throw e
      }
      if (isInsufficientSpaceError(e)) {
        // No room is not a file error. Clear the entry so no error badge shows,
        // but rethrow so an awaiting caller sees why. Usually a programmatic or
        // auto caller that skipped the precheck; a user path can reach here too
        // if free space drops between its precheck and this backstop.
        if (current()) remove(fileId)
        throw e
      }
      if (!controller.signal.aborted) {
        update(fileId, { status: 'error', error: getErrorMessage(e) })
      }
      throw e
    } finally {
      release?.()
      if (current()) {
        controllers.delete(fileId)
        inFlight.delete(fileId)
        inFlightSizes.delete(fileId)
        priorities.delete(fileId)
      }
    }
  }

  async function executeShareUrl(id: string, url: string): Promise<void> {
    // Caller (downloadFromShareUrl) registers synchronously before awaiting.
    const controller = controllers.get(id)!
    let release: (() => void) | undefined
    try {
      const sdk = getSdk()
      if (!sdk) throw new Error('SDK not initialized')

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
          // Acquire only once the size is known and there is room, so a slow
          // SDK resolve or an immediate no-space refusal doesn't hold a slot
          // other downloads are waiting on. Matches execute()'s ordering.
          release = await slotPool.acquire(controller.signal, { priority: SLOT_PRIORITY.user })
          update(id, { status: 'downloading' })
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
    wasDropped: (id) => dropped.has(id),
    checkSpaceFor,
    downloadFile: (fileId, priority) => {
      const existing = inFlight.get(fileId)
      if (existing) {
        if (priority === 'user' && priorities.get(fileId) === 'background') {
          priorities.set(fileId, 'user')
          slotPool.promote(fileId, SLOT_PRIORITY.user)
        }
        return existing
      }
      register(fileId)
      priorities.set(fileId, priority)
      const promise = execute(fileId, priority)
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
      priorities.delete(id)
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
      priorities.clear()
      dropped.clear()
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
