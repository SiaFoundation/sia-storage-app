import { logger } from '@siastorage/logger'
import type { AppService } from '../app/service'
import type { EvictionCursor, EvictionRow } from '../db/operations'
import {
  FS_EVICTABLE_MIN_AGE,
  FS_EVICTABLE_MIN_AGE_NON_CURRENT,
  FS_EVICTION_THUMBNAIL_WAIT,
  FS_MAX_BYTES,
} from '../config'
import { evictLeastRecentlyUsed } from './leastRecentlyUsed'
import { tidyCopies } from './localCopies'
import { syncMount } from './mountSync'

export type CacheEvictionConfig = {
  maxBytes?: number
  /** Age gate for the LRU cap-driven pass. Defaults to `FS_EVICTABLE_MIN_AGE`. */
  minAge?: number
  /** Age gate for the non-current pre-pass. Defaults to `FS_EVICTABLE_MIN_AGE_NON_CURRENT`. */
  minAgeNonCurrent?: number
  /**
   * How long the LRU pass keeps a copy whose thumbnails are not made yet,
   * from when the copy was added. Defaults to `FS_EVICTION_THUMBNAIL_WAIT`,
   * and 0 does not wait.
   */
  thumbnailWait?: number
  batchSize?: number
}

/**
 * Evicts every local copy whose bytes are safely on the network, rather than
 * trimming back to the cap.
 *
 * The scheduled scan exists to hold the cache under `FS_MAX_BYTES`, so it skips
 * the LRU pass entirely while under that and spares anything used recently. A
 * user asking to clear local files is asking for neither gate: with no cap and
 * no age threshold, every backed-up file is a candidate, including one whose
 * thumbnails are not made yet. Local-only files are still kept, because that
 * guard lives in the queries rather than here.
 */
export const EVICT_ALL_BACKED_UP: CacheEvictionConfig = {
  maxBytes: 0,
  minAge: 0,
  minAgeNonCurrent: 0,
  thumbnailWait: 0,
}

/** Whether a clear is running, for a window that shows it in progress. */
export type ClearState = {
  /** True from when a clear is asked for, including while it waits for a pass, until it ends. */
  running: boolean
  /**
   * Clear passes that ended since the process started. A window compares it
   * with the count when it started a clear, to tell that one has ended.
   */
  finished: number
  /** Bytes the last clear pass to end freed. Null before the first ends, or when it failed. */
  lastBytesFreed: number | null
}

export type CacheEvictionResult = {
  processedRows: number
  evicted: number
  evictedFileIds: string[]
  /**
   * Bytes this pass freed: the `fs` row sizes of the cache copies it deleted,
   * and the recorded bytes of the mount copies the system removed for it,
   * which for a file read by ranges is the bytes served. A range the system
   * had already dropped on its own is counted too, since nothing reports it.
   */
  bytesFreed: number
  currentSize: number
}

/**
 * Each pass reads past the last row of its previous batch rather than from the
 * oldest row again. A removal that throws leaves its row in place, so a batch of
 * such rows would otherwise come back on every iteration until the pass is
 * aborted.
 */
function cursorAfter(rows: EvictionRow[]): EvictionCursor {
  const last = rows[rows.length - 1]
  return { usedAt: last.usedAt, fileId: last.fileId }
}

/** The cap and minimum age the user configured, for the scheduled pass. */
export async function configuredCacheEviction(app: AppService): Promise<CacheEvictionConfig> {
  const [maxBytes, minAge] = await Promise.all([
    app.settings.getCacheMaxBytes(),
    app.settings.getCacheMinAge(),
  ])
  return { maxBytes: maxBytes ?? Number.POSITIVE_INFINITY, minAge }
}

/**
 * Runs one pass at a time over the cache: the scheduled pass, `cache.evict`,
 * `cache.clear`, and the early read of the mount's files (`walk`), which
 * frees nothing. An `evict` while an evicting pass runs gets that pass's
 * result, so a pass requested over the socket during the scheduled one does
 * not start a second pass over the same rows. An `evict` while a walk runs
 * waits for it and then starts its own. A `clear` while a clear runs gets its
 * result, and while anything else runs waits for it and then clears, since
 * an evict keeps the recently used files a clear has to remove. A `walk`
 * starts only when nothing runs, and its caller checks `busy` first. A clear
 * can take minutes on a large library, so `clearState` lets a window that
 * did not wait for it show it running and what it freed.
 *
 * Each pass runs on a signal of its own, which any caller's signal aborts. A
 * caller that joined a pass someone else started still stops it, so the
 * scheduler's shutdown stops a pass a socket request started instead of
 * waiting for all of it. `stop` aborts the running pass, waits for it, and
 * refuses every pass asked for after it, for a shutdown about to close the
 * database: a removal cut off between deleting a file and deleting its `fs`
 * row would leave a row for bytes that are gone.
 */
export function evictionRunner(
  run: (
    config: CacheEvictionConfig,
    signal: AbortSignal,
  ) => Promise<CacheEvictionResult | undefined>,
  configured: () => Promise<CacheEvictionConfig>,
  walk: (signal: AbortSignal) => Promise<unknown> = async () => {},
): {
  evict(signal?: AbortSignal): Promise<CacheEvictionResult | undefined>
  clear(): Promise<CacheEvictionResult | undefined>
  walk(signal?: AbortSignal): Promise<void>
  clearState(): ClearState
  /** Whether any pass is running now. */
  busy(): boolean
  stop(): Promise<void>
} {
  type Kind = 'evict' | 'clear' | 'walk'
  type Pass = {
    kind: Kind
    done: Promise<CacheEvictionResult | undefined>
    controller: AbortController
  }
  let running: Pass | null = null
  let stopped = false
  let clears = 0
  let finished = 0
  let lastBytesFreed: number | null = null
  const start = (kind: Kind): Pass => {
    const controller = new AbortController()
    const pass = async () => {
      if (kind === 'walk') {
        await walk(controller.signal)
        return undefined
      }
      return run(kind === 'clear' ? EVICT_ALL_BACKED_UP : await configured(), controller.signal)
    }
    const done: Promise<CacheEvictionResult | undefined> = pass().finally(() => {
      if (running?.done === done) running = null
    })
    // Counted on the pass rather than per caller, so a clear that joins a
    // running one does not count it twice.
    if (kind === 'clear') {
      done.then(
        (result) => {
          lastBytesFreed = result?.bytesFreed ?? null
          finished++
        },
        () => {
          lastBytesFreed = null
          finished++
        },
      )
    }
    running = { kind, done, controller }
    return running
  }
  const join = (pass: Pass, signal?: AbortSignal) => {
    if (signal) {
      const abort = () => pass.controller.abort()
      if (signal.aborted) abort()
      signal.addEventListener('abort', abort, { once: true })
      void pass.done.finally(() => signal.removeEventListener('abort', abort)).catch(() => {})
    }
    return pass.done
  }
  return {
    evict: async (signal) => {
      // A walk frees nothing, so joining one would skip this pass.
      while (running?.kind === 'walk') await running.done.catch(() => undefined)
      if (stopped) return undefined
      return join(running ?? start('evict'), signal)
    },
    clear: async () => {
      clears++
      try {
        while (running && running.kind !== 'clear') await running.done.catch(() => undefined)
        if (stopped) return undefined
        return await join(running ?? start('clear'))
      } finally {
        clears--
      }
    },
    clearState: () => ({ running: clears > 0, finished, lastBytesFreed }),
    walk: async (signal) => {
      if (stopped || running) return
      await join(start('walk'), signal)
    },
    busy: () => running !== null,
    stop: async () => {
      stopped = true
      const pass = running
      if (!pass) return
      pass.controller.abort()
      await pass.done.catch(() => undefined)
    },
  }
}

/**
 * Evicts cached files in three passes:
 *   1. Trashed pre-pass: uploaded files the user has trashed, no age gate.
 *   2. Non-current pre-pass: superseded versions past `minAgeNonCurrent`.
 *   3. LRU loop: oldest uploaded files past `minAge`, only while over `maxBytes`,
 *      skipping a file whose thumbnails are not made yet for up to
 *      `thumbnailWait` after its copy was added.
 *
 * On a library with a mount, the folder a file manager shows, the pass first
 * reads which files the system removed from it on its own (`syncMount`) and
 * removes cache copies of files the mount also holds (`tidyCopies`). The
 * mount's bytes then count against `maxBytes`, and pass 3 frees the least
 * recently used copy from either place (`evictLeastRecentlyUsed`).
 *
 * A current or trashed file is evicted only while it has an object on the
 * current indexer, read per batch and again before each removal. A superseded
 * version needs an object on any indexer, since the uploader never sends one.
 *
 * Suspension signal policy: accepts AbortSignal. Each pass holds a sequence
 * of disk + DB writes; checks the signal between batches and between rows
 * so a mid-eviction abort releases promptly before the DB gate closes. An
 * abort during a call to the system loses that call's answers, and the next
 * pass's read of the mount corrects the rows.
 */
export async function runCacheEviction(
  app: AppService,
  config?: CacheEvictionConfig,
  signal?: AbortSignal,
): Promise<CacheEvictionResult | undefined> {
  const maxBytes = config?.maxBytes ?? FS_MAX_BYTES
  const minAge = config?.minAge ?? FS_EVICTABLE_MIN_AGE
  const minAgeNonCurrent = config?.minAgeNonCurrent ?? FS_EVICTABLE_MIN_AGE_NON_CURRENT
  const thumbnailWait = config?.thumbnailWait ?? FS_EVICTION_THUMBNAIL_WAIT
  const batchSize = config?.batchSize ?? 100

  // Before the totals are read: the second step changes what the cache holds.
  const mount = await app.settings.getMount()
  await syncMount(app, signal)
  await tidyCopies(app, { signal })
  const totalSize = await app.fs.calcTotalSize()
  const mountSize = mount ? await app.mountCopies.onlyBytes() : 0
  logger.info('cacheEviction', 'starting', { totalSize, mountSize, limit: maxBytes })

  let currentSize = totalSize
  let processedRows = 0
  let evicted = 0
  let bytesFreed = 0
  const evictedFileIds: string[] = []

  /** Counts a removed copy. The cache total never held a mount copy. */
  function recordEvicted(copy: { fileId: string; size: number }, store: 'cache' | 'mount'): void {
    if (store === 'cache') currentSize -= copy.size
    bytesFreed += copy.size
    evicted++
    evictedFileIds.push(copy.fileId)
  }

  /**
   * Deletes one cache copy, and resolves whether it went. A copy a download
   * or a Finder export holds is used now, so it is skipped this pass rather
   * than waited for.
   */
  async function removeCopy(row: EvictionRow, anyIndexer = false): Promise<boolean> {
    try {
      // The batch was read against the indexer current at the time. After a
      // switch since then, this file may have no object on the new one, and
      // the uploader, which reads only local copies, could never send it there.
      if (!anyIndexer) {
        const indexerURL = await app.settings.getIndexerURL()
        if ((await app.localObjects.countForFileOnIndexer(row.fileId, indexerURL)) === 0) {
          return false
        }
      }
      return await app.fs.removeFile({ id: row.fileId, type: row.type }, { skipIfLocked: true })
    } catch (e) {
      logger.error('cacheEviction', 'remove_failed', { fileId: row.fileId, error: e as Error })
      return false
    }
  }

  async function evictBatch(rows: EvictionRow[], anyIndexer = false): Promise<void> {
    for (const row of rows) {
      if (signal?.aborted) return
      if (await removeCopy(row, anyIndexer)) recordEvicted(row, 'cache')
    }
  }

  // Pass 1: trashed uploaded files. User explicitly trashed them; evict on
  // the next pass with no age gate.
  let afterTrashed: EvictionCursor | null = null
  while (!signal?.aborted) {
    const trashed = await app.fs.trashedCachedFiles(
      await app.settings.getIndexerURL(),
      afterTrashed,
      batchSize,
    )
    if (trashed.length === 0) break
    afterTrashed = cursorAfter(trashed)
    await evictBatch(trashed)
    processedRows += trashed.length
    if (trashed.length < batchSize) break
  }

  // Pass 2: superseded file versions past the short grace. They can never
  // become current again, so keeping them cached wastes space regardless of
  // whether the cap is exceeded.
  let afterNonCurrent: EvictionCursor | null = null
  while (!signal?.aborted) {
    const thresholdUsedAt = Date.now() - minAgeNonCurrent
    const nonCurrent = await app.fs.nonCurrentCachedFiles(
      thresholdUsedAt,
      afterNonCurrent,
      batchSize,
    )
    if (nonCurrent.length === 0) break
    afterNonCurrent = cursorAfter(nonCurrent)
    await evictBatch(nonCurrent, true)
    processedRows += nonCurrent.length
    if (nonCurrent.length < batchSize) break
  }

  // Pass 3: LRU while over cap, across the cache and the mount.
  const over = currentSize + mountSize - maxBytes
  if (over > 0) {
    processedRows += await evictLeastRecentlyUsed(app, {
      over,
      minAge,
      batchSize,
      thumbnails:
        thumbnailWait > 0
          ? { types: app.thumbnails.allowedTypes, addedBefore: Date.now() - thumbnailWait }
          : undefined,
      mount: mount !== null,
      removeCacheCopy: removeCopy,
      evicted: recordEvicted,
      signal,
    })
  }

  // List rows carry the on-device flag from the query itself, so clearing
  // each file's cached path is not enough: the list keeps showing evicted
  // files as downloaded until it refetches.
  if (evicted > 0) {
    await app.caches.library.invalidateAll()
    app.caches.libraryVersion.invalidate()
  }

  logger.info('cacheEviction', 'complete', {
    processedRows,
    evicted,
    currentSize,
    aborted: signal?.aborted ?? false,
  })
  return { processedRows, evicted, evictedFileIds, bytesFreed, currentSize }
}
