/*
 * syncPhotosArchive — polls every 5s, fetches 1 page of 50 photos.
 *
 * Two modes of operation:
 *
 * 1. Initial walk: walks the entire photo library from newest to oldest
 *    by endCursor, stopping when all photos have been visited
 *    (cursor = 'done'). Pauses when pending local-only bytes exceed
 *    4 slabs to avoid overwhelming the upload pipeline.
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
 */

import { useApp } from '@siastorage/core/app'
import {
  SYNC_ARCHIVE_RECENT_SCAN_INTERVAL,
  SYNC_ARCHIVE_RECENT_SCAN_LOOKBACK,
  SYNC_ARCHIVE_RESUME_THRESHOLD,
  SYNC_PHOTOS_ARCHIVE_INTERVAL,
} from '@siastorage/core/config'
import { createServiceInterval } from '@siastorage/core/lib/serviceInterval'
import { logger } from '@siastorage/logger'
import * as MediaLibrary from 'expo-media-library'
import useSWR from 'swr'
import {
  ensureMediaLibraryPermission,
  getMediaLibraryPermissions,
  mediaLibraryPermissionsCache,
} from '../lib/mediaLibraryPermissions'
import { processAssets } from '../lib/processAssets'
import { app } from '../stores/appService'
import { getFileStatsLocal } from '../stores/files'

const PAGE_SIZE = 50
const CURSOR_DONE = 'done'
const CURSOR_START = 'start'

let recentScanBoundary = 0

export async function workBackward(signal?: AbortSignal) {
  logger.debug('syncPhotosArchive', 'tick')
  if (!(await getMediaLibraryPermissions())) return
  if (signal?.aborted) return
  const { count, totalBytes } = await getFileStatsLocal({ localOnly: true })
  if (totalBytes >= SYNC_ARCHIVE_RESUME_THRESHOLD) {
    logger.info('syncPhotosArchive', 'skipped', {
      reason: 'local_only_pending',
      count,
      totalBytes,
    })
    return
  }
  const cursor = await getPhotosArchiveCursor()
  if (cursor === CURSOR_DONE) return

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
    if (signal?.aborted) return
    const { files } = await processAssets(
      assets.map((asset) => ({
        id: asset.id,
        sourceUri: asset.uri,
        name: asset.filename,
        type: undefined,
        size: undefined,
        timestamp: new Date(
          asset.creationTime || asset.modificationTime,
        ).toISOString(),
      })),
      'file',
      { addToImportDirectory: true },
    )
    if (files.length > 0) {
      logger.info('syncPhotosArchive', 'batch_processed', {
        newFiles: files.length,
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

export const { init: initSyncPhotosArchive } = createServiceInterval({
  name: 'syncPhotosArchive',
  worker: workBackward,
  getState: async () => getAutoSyncPhotosArchive(),
  interval: SYNC_PHOTOS_ARCHIVE_INTERVAL,
})

export async function getAutoSyncPhotosArchive(): Promise<boolean> {
  const raw = await app().storage.getItem('autoSyncPhotosArchive')
  return raw === null ? false : raw === 'true'
}

export function useAutoSyncPhotosArchive() {
  const app = useApp()
  return useSWR(app.caches.settings.key('autoSyncPhotosArchive'), () =>
    getAutoSyncPhotosArchive(),
  )
}

export async function setAutoSyncPhotosArchive(value: boolean) {
  await app().storage.setItem('autoSyncPhotosArchive', String(value))
  app().caches.settings.invalidate('autoSyncPhotosArchive')
  if (value) {
    ensureMediaLibraryPermission()
  }
  mediaLibraryPermissionsCache.invalidate()
}

export async function toggleAutoSyncPhotosArchive() {
  const current = await getAutoSyncPhotosArchive()
  const next = !current
  await setAutoSyncPhotosArchive(next)
}

export async function getPhotosArchiveCursor(): Promise<string> {
  const raw = await app().storage.getItem('archiveSyncCursor')
  return (raw ?? CURSOR_DONE) as string
}

export function usePhotosArchiveCursor() {
  const app = useApp()
  return useSWR(app.caches.settings.key('archiveSyncCursor'), () =>
    getPhotosArchiveCursor(),
  )
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

export async function getLastRecentScanAt(): Promise<number> {
  const raw = await app().storage.getItem('lastRecentScanAt')
  const n = raw ? Number(raw) : 0
  return Number.isFinite(n) ? n : 0
}

export async function setLastRecentScanAt(value: number) {
  await app().storage.setItem('lastRecentScanAt', String(value))
  app().caches.settings.invalidate('lastRecentScanAt')
}

export async function triggerRecentScanIfNeeded(): Promise<boolean> {
  const cursor = await getPhotosArchiveCursor()
  if (cursor !== CURSOR_DONE) return false

  const lastScan = await getLastRecentScanAt()
  if (Date.now() - lastScan < SYNC_ARCHIVE_RECENT_SCAN_INTERVAL) return false

  await restartPhotosArchiveCursor()
  recentScanBoundary = Date.now() - SYNC_ARCHIVE_RECENT_SCAN_LOOKBACK
  return true
}
