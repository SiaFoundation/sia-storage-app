import {
  OS_THUMB_CAPTURE_BATCH,
  OS_THUMB_CAPTURE_CONCURRENCY,
  OS_THUMB_CAPTURE_INTERVAL,
} from '@siastorage/core/config'
import { BackoffTracker } from '@siastorage/core/lib/backoffTracker'
import { createServiceInterval } from '@siastorage/core/lib/serviceInterval'
import { uniqueId } from '@siastorage/core/lib/uniqueId'
import type { FileRecord, ThumbSize } from '@siastorage/core/types'
import { ThumbSizes } from '@siastorage/core/types'
import { logger } from '@siastorage/logger'
import { getOsThumbnail } from 'sia-os-thumb'
import { app } from '../stores/appService'
import { isBgTaskActive } from './bgTaskContext'

const backoff = new BackoffTracker()

type CapturedThumb = {
  fileId: string
  size: ThumbSize
  record: Omit<FileRecord, 'objects'>
}

type CaptureFailure = 'os_null' | 'adopt_failed'
type CaptureOutcome = { ok: true; thumb: CapturedThumb } | { ok: false; reason: CaptureFailure }

async function captureOne(
  fileId: string,
  localId: string,
  size: ThumbSize,
  mimeFallback: string,
): Promise<CaptureOutcome> {
  // Native side does the IPC, decode, JPEG encode, and tmp-file write on
  // background threads. We only orchestrate.
  const r = await getOsThumbnail(localId, size)
  if (!r) {
    backoff.recordSkip(fileId, `os-thumb-null:${size}`)
    return { ok: false, reason: 'os_null' }
  }
  try {
    const thumbId = uniqueId()
    // adoptFile = RNFS.moveFile + RNFS.hash, both native. No JS-thread bytes.
    const adopted = await app().fs.adoptFile({ id: thumbId, type: r.mimeType }, r.uri)
    const now = Date.now()
    return {
      ok: true,
      thumb: {
        fileId,
        size,
        record: {
          id: thumbId,
          name: 'thumbnail.jpg',
          type: r.mimeType || mimeFallback,
          kind: 'thumb',
          size: adopted.size,
          hash: `sha256:${adopted.hash}`,
          createdAt: now,
          updatedAt: now,
          addedAt: now,
          localId: null,
          thumbForId: fileId,
          thumbSize: size,
          trashedAt: null,
          deletedAt: null,
        },
      },
    }
  } catch (e) {
    backoff.recordSkip(fileId, `adopt-failed:${size}`)
    logger.warn('osThumbCapture', 'adopt_failed', {
      fileId,
      localId,
      size,
      error: e as Error,
    })
    return { ok: false, reason: 'adopt_failed' }
  }
}

/**
 * OS-thumb capture loop. Pulls files with a `localId` that still need
 * thumbnails — including archive-walk placeholders whose bodies haven't
 * been copied yet — and fetches the system-cached tile via PHImageManager
 * (iOS) or ContentResolver.loadThumbnail (Android). Runs ahead of the
 * `importScanner`'s body-copy backpressure: artifacts are tiny and aren't
 * queued for upload until their parent file is finalized.
 *
 * Heavy work runs off the JS thread: photolibraryd / MediaProvider do the
 * decode and scale; the native module's JPEG encode and tmp-file write run
 * on background queues; `adoptFile` is native (RNFS.moveFile + RNFS.hash);
 * the DB write is one batched `files.createMany` per tick. Failures land
 * in a shared `BackoffTracker` and are excluded from subsequent queries.
 */
async function run(signal: AbortSignal): Promise<void> {
  if (isBgTaskActive('BGAppRefreshTask')) {
    logger.debug('osThumbCapture', 'skipped', { reason: 'bg_app_refresh_no_cpu_budget' })
    return
  }
  if (app().sync.getState().syncGateStatus === 'active') {
    logger.debug('osThumbCapture', 'skipped', { reason: 'sync_gate_active' })
    return
  }

  const allowedTypes = app().thumbnails.allowedTypes
  // PHImageManager / loadThumbnail handle still images natively; video is a
  // separate code path on iOS and stays on the deferred scanner for now.
  const imageTypes = allowedTypes.filter((t) => t.startsWith('image/'))
  if (imageTypes.length === 0) return

  const excludeIds = backoff.getExcludeIds()
  const queryStart = Date.now()
  const candidates = await app().thumbnails.queryMissingOsThumbCandidates(
    OS_THUMB_CAPTURE_BATCH,
    imageTypes,
    excludeIds.length > 0 ? excludeIds : undefined,
  )
  const queryMs = Date.now() - queryStart
  if (candidates.length === 0) {
    logger.debug('osThumbCapture', 'idle', { excluded: excludeIds.length, queryMs })
    return
  }

  const sizesByFileId = await app().thumbnails.getSizesForFiles(candidates.map((c) => c.id))

  // Build a flat work list of (file × missing size) so the concurrency pool
  // saturates regardless of per-file size shape (1 missing vs 2 missing).
  type Job = { fileId: string; localId: string; size: ThumbSize; mimeFallback: string }
  const jobs: Job[] = []
  for (const c of candidates) {
    const existing = sizesByFileId.get(c.id) ?? []
    for (const size of ThumbSizes) {
      if (!existing.includes(size)) {
        jobs.push({ fileId: c.id, localId: c.localId, size, mimeFallback: c.type })
      }
    }
  }
  if (jobs.length === 0) return

  // Concurrency pool: keeps OS_THUMB_CAPTURE_CONCURRENCY native calls in
  // flight. Each call's wait happens out-of-process; in-process cost is a
  // small JPEG encode + RNFS move + RNFS hash, all on native threads.
  const captured: CapturedThumb[] = []
  const failureCounts = { os_null: 0, adopt_failed: 0 }
  const newlyExcluded = new Set<string>()
  let cursor = 0
  async function worker(): Promise<void> {
    while (!signal.aborted) {
      const idx = cursor++
      if (idx >= jobs.length) return
      const job = jobs[idx]
      const outcome = await captureOne(job.fileId, job.localId, job.size, job.mimeFallback)
      if (outcome.ok) {
        captured.push(outcome.thumb)
      } else {
        failureCounts[outcome.reason] += 1
        newlyExcluded.add(job.fileId)
      }
    }
  }
  const tickStart = Date.now()
  await Promise.all(
    Array.from({ length: Math.min(OS_THUMB_CAPTURE_CONCURRENCY, jobs.length) }, () => worker()),
  )
  const captureMs = Date.now() - tickStart
  if (signal.aborted) return

  if (captured.length > 0) {
    await app().db.waitUntilActive()
    await app().files.createMany(
      captured.map((c) => c.record),
      { conflictClause: 'OR IGNORE', skipCurrentRecalc: true },
    )

    const touchedFileIds = new Set(captured.map((c) => c.fileId))
    for (const fileId of touchedFileIds) {
      backoff.clear(fileId)
      await app().caches.thumbnails.byFileId.invalidate(fileId)
    }
    for (const c of captured) {
      await app().caches.thumbnails.best.invalidate(c.fileId, String(c.size))
    }
  }

  const filesAttempted = new Set(jobs.map((j) => j.fileId)).size
  const filesSucceeded = new Set(captured.map((c) => c.fileId)).size
  logger.info('osThumbCapture', 'tick', {
    files_attempted: filesAttempted,
    files_succeeded: filesSucceeded,
    files_newly_excluded: newlyExcluded.size,
    jobs_total: jobs.length,
    jobs_succeeded: captured.length,
    jobs_failed_os_null: failureCounts.os_null,
    jobs_failed_adopt: failureCounts.adopt_failed,
    excluded_persistent: excludeIds.length,
    query_ms: queryMs,
    capture_ms: captureMs,
  })
}

export const { init: initOsThumbCapture, triggerNow: triggerOsThumbCapture } =
  createServiceInterval({
    name: 'osThumbCapture',
    worker: run,
    interval: OS_THUMB_CAPTURE_INTERVAL,
  })
