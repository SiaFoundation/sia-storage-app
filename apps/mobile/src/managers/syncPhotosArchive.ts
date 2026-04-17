/*
 * syncPhotosArchive — one-shot walk of the photo library.
 *
 * Two modes of operation:
 *
 * 1. Initial walk: walks the entire photo library from newest to oldest
 *    by endCursor, stopping when all photos have been visited
 *    (cursor = 'done'). Runs back-to-back with only a yieldToEventLoop()
 *    between pages.
 *
 * 2. Bounded recent re-scan: after the initial walk completes, a
 *    periodic re-scan is triggered during background tasks (every ~3h)
 *    to catch photos synced from other devices (e.g. iCloud) that
 *    appear with old timestamps in the middle of the sorted list where
 *    syncNewPhotos (which only sees the top 50) misses them. The
 *    re-scan walks from the top and stops when it crosses a 14-day
 *    boundary. This runs during background tasks where the device is
 *    idle and heavier DB work is free.
 *
 * Sorts by modificationTime DESC because:
 * - Android: DATE_TAKEN can be NULL for imported/downloaded photos,
 *   silently excluding them from createdAfter/createdBefore queries.
 * - iOS: creationDate can be an old EXIF date; modificationDate is the
 *   iCloud-synced metadata timestamp (not local arrival time).
 *
 * Catches: the full historical tail plus periodic re-scans of the
 * recent window for cross-device synced photos.
 * Misses: newly taken photos (covered by syncNewPhotos).
 *
 * Suspension signal policy: accepts AbortSignal. DB-holding walk loop
 * — writes via catalogAssets on each page. NOT driven by the service
 * scheduler; uses its own module-level walkAbortController managed
 * by pauseArchiveSync() / resumeArchiveSync() hooks wired into the
 * suspension manager's onBeforeSuspend / onAfterResume.
 */

import { useApp } from '@siastorage/core/app'
import {
  SYNC_ARCHIVE_RECENT_SCAN_INTERVAL,
  SYNC_ARCHIVE_RECENT_SCAN_LOOKBACK,
} from '@siastorage/core/config'
import { yieldToEventLoop } from '@siastorage/core/lib/yieldToEventLoop'
import { logger } from '@siastorage/logger'
import * as MediaLibrary from 'expo-media-library'
import useSWR from 'swr'
import { getMediaLibraryPermissions } from '../lib/mediaLibraryPermissions'
import { catalogAssets } from '../lib/processAssets'
import { app } from '../stores/appService'

const PAGE_SIZE = 500
const CURSOR_DONE = 'done'
const CURSOR_START = 'start'

let recentScanBoundary = 0
let activeWalk: Promise<void> | null = null
let walkAbortController: AbortController | null = null
let photosAddedCount = 0
let photosExistingCount = 0

export async function startArchiveSync(): Promise<void> {
  if (activeWalk) return
  photosAddedCount = 0
  photosExistingCount = 0
  await setPhotosAddedCount(0)
  await setPhotosExistingCount(0)
  await restartPhotosArchiveCursor()
  walkAbortController = new AbortController()
  activeWalk = runArchiveWalk(walkAbortController.signal)
  activeWalk.finally(() => {
    activeWalk = null
    walkAbortController = null
  })
}

export async function stopArchiveSync(): Promise<void> {
  walkAbortController?.abort()
  await setPhotosArchiveCursor(CURSOR_DONE)
}

/** Abort the in-flight walk without clearing cursor so it resumes from the same page. */
export function pauseArchiveSync(): void {
  walkAbortController?.abort()
}

/** Restart the walk from where it left off if cursor isn't DONE. */
export async function resumeArchiveSync(): Promise<void> {
  if (activeWalk) return
  const cursor = await getPhotosArchiveCursor()
  if (cursor === CURSOR_DONE) return
  walkAbortController = new AbortController()
  activeWalk = runArchiveWalk(walkAbortController.signal)
  activeWalk.finally(() => {
    activeWalk = null
    walkAbortController = null
  })
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
    const { newCount, existingCount } = await catalogAssets(
      assets.map((asset) => ({
        id: asset.id,
        sourceUri: asset.uri,
        name: asset.filename,
        type: undefined,
        size: undefined,
        timestamp: new Date(asset.creationTime || asset.modificationTime).toISOString(),
      })),
      'file',
      { addToImportDirectory: true },
      signal,
    )
    photosAddedCount += assets.length
    photosExistingCount += existingCount
    await setPhotosAddedCount(photosAddedCount)
    await setPhotosExistingCount(photosExistingCount)
    if (newCount > 0) {
      logger.info('syncPhotosArchive', 'batch_processed', {
        newCount,
        existingCount,
        totalAssets: assets.length,
      })
      await app().caches.library.invalidateAll()
      app().caches.libraryVersion.invalidate()
    } else {
      logger.info('syncPhotosArchive', 'batch_all_duplicates', {
        totalAssets: assets.length,
      })
    }

    if (recentScanBoundary > 0 && oldestModTime < recentScanBoundary) {
      logger.info('syncPhotosArchive', 'recent_scan_boundary_reached', {
        oldestModTime: new Date(oldestModTime).toISOString(),
        boundary: new Date(recentScanBoundary).toISOString(),
      })
      recentScanBoundary = 0
      await setPhotosArchiveCursor(CURSOR_DONE)
      await setPhotosArchiveDisplayDate(0)
      await setLastRecentScanAt(Date.now())
      await setArchiveSyncCompletedAt(Date.now())
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
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
  recentScanBoundary = 0
  logger.info('syncPhotosArchive', 'cursor_restart')
  await setPhotosArchiveCursor(CURSOR_START)
  await setPhotosArchiveDisplayDate(0)
}

export async function resetPhotosArchiveCursor() {
  logger.info('syncPhotosArchive', 'cursor_disable')
  await setPhotosArchiveCursor(CURSOR_DONE)
  await setPhotosArchiveDisplayDate(0)
}

export async function getPhotosArchiveDisplayDate(): Promise<number> {
  const raw = await app().storage.getItem('photosArchiveDisplayDate')
  const n = raw ? Number(raw) : 0
  return Number.isFinite(n) ? n : 0
}

export function usePhotosArchiveDisplayDate() {
  const app = useApp()
  return useSWR(app.caches.settings.key('photosArchiveDisplayDate'), () =>
    getPhotosArchiveDisplayDate(),
  )
}

export async function setPhotosArchiveDisplayDate(value: number) {
  await app().storage.setItem('photosArchiveDisplayDate', String(value))
  app().caches.settings.invalidate('photosArchiveDisplayDate')
}

export async function getArchiveSyncCompletedAt(): Promise<number> {
  const raw = await app().storage.getItem('archiveSyncCompletedAt')
  const n = raw ? Number(raw) : 0
  return Number.isFinite(n) ? n : 0
}

export async function setArchiveSyncCompletedAt(value: number) {
  await app().storage.setItem('archiveSyncCompletedAt', String(value))
  app().caches.settings.invalidate('archiveSyncCompletedAt')
}

export function useArchiveSyncCompletedAt() {
  const app = useApp()
  return useSWR(app.caches.settings.key('archiveSyncCompletedAt'), () =>
    getArchiveSyncCompletedAt(),
  )
}

export async function getLastRecentScanAt(): Promise<number> {
  const raw = await app().storage.getItem('lastRecentScanAt')
  const n = raw ? Number(raw) : 0
  return Number.isFinite(n) ? n : 0
}

export async function setLastRecentScanAt(value: number) {
  await app().storage.setItem('lastRecentScanAt', String(value))
  app().caches.settings.invalidate('lastRecentScanAt')
}

export async function getPhotosAddedCount(): Promise<number> {
  const raw = await app().storage.getItem('photosAddedCount')
  const n = raw ? Number(raw) : 0
  return Number.isFinite(n) ? n : 0
}

export function usePhotosAddedCount() {
  const app = useApp()
  return useSWR(app.caches.settings.key('photosAddedCount'), () => getPhotosAddedCount())
}

export async function setPhotosAddedCount(value: number) {
  await app().storage.setItem('photosAddedCount', String(value))
  app().caches.settings.invalidate('photosAddedCount')
}

export async function getPhotosExistingCount(): Promise<number> {
  const raw = await app().storage.getItem('photosExistingCount')
  const n = raw ? Number(raw) : 0
  return Number.isFinite(n) ? n : 0
}

export function usePhotosExistingCount() {
  const app = useApp()
  return useSWR(app.caches.settings.key('photosExistingCount'), () => getPhotosExistingCount())
}

export async function setPhotosExistingCount(value: number) {
  await app().storage.setItem('photosExistingCount', String(value))
  app().caches.settings.invalidate('photosExistingCount')
}

export async function triggerRecentScanIfNeeded(): Promise<boolean> {
  const cursor = await getPhotosArchiveCursor()
  if (cursor !== CURSOR_DONE) return false

  // Only re-scan if the user has completed at least one full archive sync.
  const completedAt = await getArchiveSyncCompletedAt()
  if (completedAt === 0) return false

  const lastScan = await getLastRecentScanAt()
  if (Date.now() - lastScan < SYNC_ARCHIVE_RECENT_SCAN_INTERVAL) return false

  await restartPhotosArchiveCursor()
  recentScanBoundary = Date.now() - SYNC_ARCHIVE_RECENT_SCAN_LOOKBACK
  return true
}
