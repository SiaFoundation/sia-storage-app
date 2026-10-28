import { logger } from '@siastorage/logger'
import type { AppService } from '../app/service'
import type { EvictionCursor, EvictionRow } from '../db/operations'
import { FS_EVICTABLE_MIN_AGE, FS_EVICTABLE_MIN_AGE_NON_CURRENT, FS_MAX_BYTES } from '../config'

export type CacheEvictionConfig = {
  maxBytes?: number
  /** Age gate for the LRU cap-driven pass. Defaults to `FS_EVICTABLE_MIN_AGE`. */
  minAge?: number
  /** Age gate for the non-current pre-pass. Defaults to `FS_EVICTABLE_MIN_AGE_NON_CURRENT`. */
  minAgeNonCurrent?: number
  batchSize?: number
}

/**
 * Evicts every local copy whose bytes are safely on the network, rather than
 * trimming back to the cap.
 *
 * The scheduled scan exists to hold the cache under `FS_MAX_BYTES`, so it skips
 * the LRU pass entirely while under that and spares anything used recently. A
 * user asking to clear local files is asking for neither gate: with no cap and
 * no age threshold, every backed-up file is a candidate. Local-only files are
 * still kept, because that guard lives in the queries rather than here.
 */
export const EVICT_ALL_BACKED_UP: CacheEvictionConfig = {
  maxBytes: 0,
  minAge: 0,
  minAgeNonCurrent: 0,
}

export type CacheEvictionResult = {
  processedRows: number
  evicted: number
  evictedFileIds: string[]
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
 * Runs one eviction pass at a time. A call while a pass is in flight gets that
 * pass's result, so a pass requested over the socket during the scheduled one
 * does not start a second pass over the same rows.
 *
 * The pass runs on a signal of its own, which any caller's signal aborts. A
 * caller that joined a pass someone else started still stops it, so the
 * scheduler's shutdown stops a pass a socket request started instead of
 * waiting for all of it. `stop` aborts the running pass, waits for it, and
 * refuses every pass asked for after it, for a shutdown about to close the
 * database: a removal cut off between deleting a file and deleting its `fs`
 * row would leave a row for bytes that are gone.
 */
export function singleFlightEviction(
  run: (signal: AbortSignal) => Promise<CacheEvictionResult | undefined>,
): {
  run(signal?: AbortSignal): Promise<CacheEvictionResult | undefined>
  stop(): Promise<void>
} {
  let inFlight: {
    done: Promise<CacheEvictionResult | undefined>
    controller: AbortController
  } | null = null
  let stopped = false
  return {
    run: async (signal) => {
      if (stopped) return undefined
      if (!inFlight) {
        const controller = new AbortController()
        const done: Promise<CacheEvictionResult | undefined> = run(controller.signal).finally(
          () => {
            if (inFlight?.done === done) inFlight = null
          },
        )
        inFlight = { done, controller }
      }
      const pass = inFlight
      if (signal) {
        const abort = () => pass.controller.abort()
        if (signal.aborted) abort()
        signal.addEventListener('abort', abort, { once: true })
        void pass.done.finally(() => signal.removeEventListener('abort', abort)).catch(() => {})
      }
      return pass.done
    },
    stop: async () => {
      stopped = true
      const pass = inFlight
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
 *   3. LRU loop: oldest uploaded files past `minAge`, only while over `maxBytes`.
 * A current or trashed file is evicted only while it has an object on the
 * current indexer, read per batch and again before each removal. A superseded
 * version needs an object on any indexer, since the uploader never sends one.
 *
 * Suspension signal policy: accepts AbortSignal. Each pass holds a sequence
 * of disk + DB writes; checks the signal between batches and between rows
 * so a mid-eviction abort releases promptly before the DB gate closes.
 */
export async function runCacheEviction(
  app: AppService,
  config?: CacheEvictionConfig,
  signal?: AbortSignal,
): Promise<CacheEvictionResult | undefined> {
  const maxBytes = config?.maxBytes ?? FS_MAX_BYTES
  const minAge = config?.minAge ?? FS_EVICTABLE_MIN_AGE
  const minAgeNonCurrent = config?.minAgeNonCurrent ?? FS_EVICTABLE_MIN_AGE_NON_CURRENT
  const batchSize = config?.batchSize ?? 100

  const totalSize = await app.fs.calcTotalSize()

  logger.info('cacheEviction', 'starting', { totalSize, limit: maxBytes })

  let currentSize = totalSize
  let processedRows = 0
  let evicted = 0
  const evictedFileIds: string[] = []

  async function evictBatch(
    rows: EvictionRow[],
    options?: { stopWhenUnderCap?: boolean; anyIndexer?: boolean },
  ): Promise<void> {
    for (const { fileId, size, type } of rows) {
      if (signal?.aborted) return
      if (options?.stopWhenUnderCap && currentSize <= maxBytes) return
      try {
        // The batch was read against the indexer current at the time. After a
        // switch since then, this file may have no object on the new one, and
        // the uploader, which reads only local copies, could never send it there.
        if (!options?.anyIndexer) {
          const indexerURL = await app.settings.getIndexerURL()
          if ((await app.localObjects.countForFileOnIndexer(fileId, indexerURL)) === 0) continue
        }
        await app.fs.removeFile({ id: fileId, type })
        currentSize -= size
        evicted++
        evictedFileIds.push(fileId)
      } catch (e) {
        logger.error('cacheEviction', 'remove_failed', {
          fileId,
          error: e as Error,
        })
      }
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
    await evictBatch(nonCurrent, { anyIndexer: true })
    processedRows += nonCurrent.length
    if (nonCurrent.length < batchSize) break
  }

  // Pass 3: LRU while over cap.
  let afterCandidates: EvictionCursor | null = null
  while (!signal?.aborted && currentSize > maxBytes) {
    const thresholdUsedAt = Date.now() - minAge
    const candidates = await app.fs.evictionCandidates(
      await app.settings.getIndexerURL(),
      thresholdUsedAt,
      afterCandidates,
      batchSize,
    )
    if (candidates.length === 0) break
    afterCandidates = cursorAfter(candidates)
    await evictBatch(candidates, { stopWhenUnderCap: true })
    processedRows += candidates.length
    if (candidates.length < batchSize) break
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
  return { processedRows, evicted, evictedFileIds, currentSize }
}
