/*
 * syncPhotosArchive — one-shot backfill walk of the photo library.
 *
 * Walks the entire library from newest to oldest by endCursor, stopping
 * when all photos have been visited (cursor = 'done'), running back-to-back
 * with only a yieldToEventLoop() between pages. This covers the historical
 * tail; photos added later are caught incrementally by syncNewPhotos's
 * insertion cursor.
 *
 * Sorts by modificationTime DESC because:
 * - Android: DATE_TAKEN can be NULL for imported/downloaded photos,
 *   silently excluding them from createdAfter/createdBefore queries.
 * - iOS: creationDate can be an old EXIF date; modificationDate is the
 *   iCloud-synced metadata timestamp (not local arrival time).
 *
 * Each page feeds the single library-scan import via addFiles; the scanner
 * drains it. The walk is not driven by the service scheduler: it holds its
 * own abort controller, and pauseArchiveSync() / resumeArchiveSync() are
 * wired into the suspension manager's onBeforeSuspend / onAfterResume.
 */

import { useApp } from '@siastorage/core/app'
import type { ImportRow } from '@siastorage/core/db/operations'
import { getErrorMessage } from '@siastorage/core/lib/errors'
import { uniqueId } from '@siastorage/core/lib/uniqueId'
import { yieldToEventLoop } from '@siastorage/core/lib/yieldToEventLoop'
import { logger } from '@siastorage/logger'
import * as MediaLibrary from 'expo-media-library'
import useSWR from 'swr'
import { buildPhotoCandidateRows, resolveImportDirectoryId } from '../lib/assetImports'
import { getMediaLibraryPermissions } from '../lib/mediaLibraryPermissions'
import { app } from '../stores/appService'
import { isBgTaskActive } from './bgTaskContext'
import { triggerImportScanner } from './importScanner'
import { acquireAutoKeepAwake, releaseAutoKeepAwake } from './autoKeepAwake'

const PAGE_SIZE = 500
const CURSOR_DONE = 'done'
const CURSOR_START = 'start'

let activeWalk: Promise<void> | null = null
let walkAbortController: AbortController | null = null
// Scan-phase progress counters for the modal. `photosScannedCount` is assets
// walked (progress vs the library total); `photosExistingCount` is assets the
// identity dedup skipped as already imported. Survivors staged = scanned - existing.
let photosScannedCount = 0
let photosExistingCount = 0
// The single library-scan import the walk is feeding. Created at walk start,
// fed per page, sealed at walk end. Held across pages (and re-resolved after
// a restart via inProgressImport) so every page drains into one import.
let activeImportId: string | null = null
// Its destination directory, cached with the id: both establishment paths
// already hold the value, so pages never re-read the import row for it.
let activeImportDirectoryId: string | null = null
// The walk's import id, kept after `sealActiveImport` clears `activeImportId`,
// so the modal can deep-link to that import's detail on hand-off.
let lastArchiveImportId: string | null = null

/** The library-scan import id the current or most recent walk fed. */
export function getArchiveImportId(): string | null {
  return lastArchiveImportId
}

/** Open the single library-scan import this walk feeds. */
async function openLibraryScanImport(): Promise<string> {
  const directoryId = await resolveImportDirectoryId()
  const now = Date.now()
  const importRow: ImportRow = {
    id: uniqueId(),
    source: 'library-scan',
    directoryId,
    pendingTags: null,
    expectedCount: 0, // grows per page as assets are discovered
    dedupByHash: 1,
    dirSourceRef: null,
    sealed: 0,
    startedAt: now,
    updatedAt: now,
  }
  await app().imports.create(importRow, [])
  lastArchiveImportId = importRow.id
  activeImportDirectoryId = directoryId
  return importRow.id
}

/** Seal + clear the active library-scan import (walk done). */
async function sealActiveImport(): Promise<void> {
  if (!activeImportId) return
  await app().imports.seal(activeImportId)
  activeImportId = null
  activeImportDirectoryId = null
}

/**
 * Resolve the import the walk should feed: the one already held, else the
 * unsealed library-scan import that survived a restart (re-enumeration is
 * idempotent, already-added assets produce no new rows), else a fresh one.
 */
async function ensureActiveImport(): Promise<string> {
  if (activeImportId) return activeImportId
  const inProgress = await app().imports.inProgressImport('library-scan')
  if (inProgress && inProgress.sealed === 0) {
    activeImportId = inProgress.id
    activeImportDirectoryId = inProgress.directoryId
  } else {
    activeImportId = await openLibraryScanImport()
  }
  lastArchiveImportId = activeImportId
  return activeImportId
}

function beginWalk(): void {
  walkAbortController = new AbortController()
  acquireAutoKeepAwake('archive-walk')
  activeWalk = runArchiveWalk(walkAbortController.signal)
  activeWalk.finally(() => {
    activeWalk = null
    walkAbortController = null
    releaseAutoKeepAwake('archive-walk')
  })
}

export async function startArchiveSync(): Promise<void> {
  if (activeWalk) return
  // The button is a no-op while a prior library-scan is still walking or
  // still draining, so two full scans never stack.
  if ((await app().imports.inProgressImport('library-scan')) !== null) {
    logger.info('syncPhotosArchive', 'start_blocked_in_progress')
    return
  }
  photosScannedCount = 0
  photosExistingCount = 0
  await setPhotosScannedCount(0)
  await setPhotosExistingCount(0)
  await restartPhotosArchiveCursor()
  activeImportId = await openLibraryScanImport()
  beginWalk()
}

export async function stopArchiveSync(): Promise<void> {
  walkAbortController?.abort()
  // Release immediately rather than waiting for the abort to propagate
  // through runArchiveWalk; the release in activeWalk.finally is idempotent.
  releaseAutoKeepAwake('archive-walk')
  await setPhotosArchiveCursor(CURSOR_DONE)
  // The walk ended by user choice; seal the import so it can reach done and
  // a new scan can start once its rows drain.
  await sealActiveImport()
}

/** Abort the in-flight walk without clearing cursor so it resumes from the same page. */
export function pauseArchiveSync(): void {
  walkAbortController?.abort()
  // Release immediately on suspend so we don't wait for the abort to
  // propagate through runArchiveWalk before the activeWalk.finally fires.
  // The release in finally is then idempotent.
  releaseAutoKeepAwake('archive-walk')
}

/** True while a walk is active (for diagnostic logging). */
export function isArchiveWalkActive(): boolean {
  return activeWalk !== null
}

/** Restart the walk from where it left off if cursor isn't DONE. */
export async function resumeArchiveSync(): Promise<void> {
  if (activeWalk) return
  // Don't restart during a fetch wake — the loop would just spin against
  // run()'s gate, hammering AsyncStorage every iteration. Walk will
  // resume on the next foreground or processing-task wake.
  if (isBgTaskActive('BGAppRefreshTask')) return
  const cursor = await getPhotosArchiveCursor()
  if (cursor === CURSOR_DONE) return
  await ensureActiveImport()
  beginWalk()
}

async function runArchiveWalk(signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    const cursor = await getPhotosArchiveCursor()
    if (cursor === CURSOR_DONE) break
    await run(signal)
    await yieldToEventLoop()
  }
}

export async function run(signal?: AbortSignal) {
  logger.debug('syncPhotosArchive', 'tick')
  if (signal?.aborted) return
  // BGAppRefreshTask still enforces iOS's 80%/60s CPU monitor; photo
  // walks can trip cpu_resource_fatal. See bgTaskContext.ts.
  if (isBgTaskActive('BGAppRefreshTask')) {
    logger.debug('syncPhotosArchive', 'skipped', { reason: 'bg_app_refresh_no_cpu_budget' })
    return
  }
  if (!(await getMediaLibraryPermissions())) {
    logger.debug('syncPhotosArchive', 'skipped', { reason: 'no_permission' })
    return
  }
  const cursor = await getPhotosArchiveCursor()
  if (cursor === CURSOR_DONE) {
    logger.debug('syncPhotosArchive', 'skipped', { reason: 'fully_synced' })
    return
  }

  if (signal?.aborted) return
  logger.info('syncPhotosArchive', 'query', {
    cursor: cursor === CURSOR_START ? 'start' : cursor,
  })

  try {
    const page = await MediaLibrary.getAssetsAsync({
      first: PAGE_SIZE,
      after: cursor !== CURSOR_START ? cursor : undefined,
      sortBy: [[MediaLibrary.SortBy.modificationTime, false]],
      mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
    })
    if (signal?.aborted) return
    if (page.assets.length === 0) {
      if (cursor !== CURSOR_START) {
        logger.info('syncPhotosArchive', 'cursor_reached_end', {
          cursor,
        })
      }
      logger.info('syncPhotosArchive', 'fully_synced')
      await setPhotosArchiveCursor(CURSOR_DONE)
      await setArchiveSyncCompletedAt(Date.now())
      // Walk done: seal so the import can reach done and a new scan can start.
      await sealActiveImport()
      return
    }
    const assets = page.assets
    const prevCursor = cursor
    await setPhotosArchiveCursor(page.endCursor)

    const oldestModTime = Math.min(...assets.map((a) => a.modificationTime))
    await setPhotosArchiveDisplayDate(oldestModTime)

    logger.info('syncPhotosArchive', 'batch', {
      size: assets.length,
      oldestModTime: new Date(oldestModTime).toISOString(),
      prevCursor: prevCursor === CURSOR_START ? 'start' : prevCursor,
      nextCursor: page.endCursor,
    })

    // Memoized: after the first page this returns the cached id with no DB
    // read. It sits per-page for the walk that restarted mid-page (recovered
    // cursor on a fresh process) and has not re-resolved the import yet.
    const importId = await ensureActiveImport()

    const now = Date.now()
    const rows = await buildPhotoCandidateRows(
      assets.map((asset) => ({
        id: asset.id,
        sourceUri: asset.uri,
        name: asset.filename,
        type: undefined,
        size: undefined,
        timestamp: new Date(asset.creationTime || asset.modificationTime).toISOString(),
      })),
      importId,
      activeImportDirectoryId,
      now,
    )
    const newCount = rows.length
    const existingCount = assets.length - newCount
    photosScannedCount += assets.length
    photosExistingCount += existingCount
    await setPhotosScannedCount(photosScannedCount)
    await setPhotosExistingCount(photosExistingCount)
    if (rows.length > 0) {
      // addFiles grows expectedCount only by rows actually added, not page
      // size (already-imported assets produce none), so the count-progress
      // denominator stays reachable.
      await app().imports.addFiles(importId, rows)
      triggerImportScanner()
      logger.info('syncPhotosArchive', 'batch_processed', {
        newCount,
        existingCount,
        totalAssets: assets.length,
      })
    } else {
      logger.info('syncPhotosArchive', 'batch_all_duplicates', {
        totalAssets: assets.length,
      })
    }
  } catch (e) {
    const msg = getErrorMessage(e)
    if (cursor !== CURSOR_START && msg.includes('cursor')) {
      logger.warn('syncPhotosArchive', 'cursor_invalid_restarting', {
        cursor,
        error: msg,
      })
      await restartPhotosArchiveCursor()
      return
    }
    logger.error('syncPhotosArchive', 'batch_error', {
      error: e as Error,
      cursor,
    })
  }
}

export async function getPhotosArchiveCursor(): Promise<string> {
  const raw = await app().storage.getItem('archiveSyncCursor')
  return (raw ?? CURSOR_DONE) as string
}

export function usePhotosArchiveCursor() {
  const app = useApp()
  return useSWR(app.caches.settings.key('archiveSyncCursor'), () => getPhotosArchiveCursor())
}

export async function setPhotosArchiveCursor(value: string) {
  await app().storage.setItem('archiveSyncCursor', value)
  app().caches.settings.invalidate('archiveSyncCursor')
}

export async function restartPhotosArchiveCursor() {
  logger.info('syncPhotosArchive', 'cursor_restart')
  await setPhotosArchiveCursor(CURSOR_START)
  await setPhotosArchiveDisplayDate(0)
}

export async function resetPhotosArchiveCursor() {
  logger.info('syncPhotosArchive', 'cursor_disable')
  await setPhotosArchiveCursor(CURSOR_DONE)
  await setPhotosArchiveDisplayDate(0)
}

async function getStoredNumber(key: string): Promise<number> {
  const raw = await app().storage.getItem(key)
  const n = raw ? Number(raw) : 0
  return Number.isFinite(n) ? n : 0
}

async function setStoredNumber(key: string, value: number): Promise<void> {
  await app().storage.setItem(key, String(value))
  app().caches.settings.invalidate(key)
}

export async function getPhotosArchiveDisplayDate(): Promise<number> {
  return getStoredNumber('photosArchiveDisplayDate')
}

export function usePhotosArchiveDisplayDate() {
  const app = useApp()
  return useSWR(app.caches.settings.key('photosArchiveDisplayDate'), () =>
    getPhotosArchiveDisplayDate(),
  )
}

export async function setPhotosArchiveDisplayDate(value: number) {
  await setStoredNumber('photosArchiveDisplayDate', value)
}

export async function getArchiveSyncCompletedAt(): Promise<number> {
  return getStoredNumber('archiveSyncCompletedAt')
}

export async function setArchiveSyncCompletedAt(value: number) {
  await setStoredNumber('archiveSyncCompletedAt', value)
}

export function useArchiveSyncCompletedAt() {
  const app = useApp()
  return useSWR(app.caches.settings.key('archiveSyncCompletedAt'), () =>
    getArchiveSyncCompletedAt(),
  )
}

export async function getPhotosScannedCount(): Promise<number> {
  return getStoredNumber('photosScannedCount')
}

export function usePhotosScannedCount() {
  const app = useApp()
  return useSWR(app.caches.settings.key('photosScannedCount'), () => getPhotosScannedCount())
}

export async function setPhotosScannedCount(value: number) {
  await setStoredNumber('photosScannedCount', value)
}

export async function getPhotosExistingCount(): Promise<number> {
  return getStoredNumber('photosExistingCount')
}

export function usePhotosExistingCount() {
  const app = useApp()
  return useSWR(app.caches.settings.key('photosExistingCount'), () => getPhotosExistingCount())
}

export async function setPhotosExistingCount(value: number) {
  await setStoredNumber('photosExistingCount', value)
}
