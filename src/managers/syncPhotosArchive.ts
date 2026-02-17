import * as MediaLibrary from 'expo-media-library'
import {
  SYNC_ARCHIVE_RESUME_THRESHOLD,
  SYNC_PHOTOS_ARCHIVE_INTERVAL,
} from '../config'
import { logger } from '../lib/logger'
import {
  ensureMediaLibraryPermission,
  getMediaLibraryPermissions,
  mediaLibraryPermissionsCache,
} from '../lib/mediaLibraryPermissions'
import { processAssets } from '../lib/processAssets'
import { createGetterAndSWRHook } from '../lib/selectors'
import { createServiceInterval } from '../lib/serviceInterval'
import {
  getAsyncStorageBoolean,
  getAsyncStorageNumber,
  setAsyncStorageBoolean,
  setAsyncStorageNumber,
} from '../stores/asyncStore'
import { getFileStatsLocal } from '../stores/files'
import {
  invalidateCacheLibraryAllStats,
  invalidateCacheLibraryLists,
} from '../stores/librarySwr'

const PAGE_SIZE = 50

export async function workBackward() {
  logger.debug('syncPhotosArchive', 'tick')
  if (!(await getMediaLibraryPermissions())) return
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

  try {
    const page = await MediaLibrary.getAssetsAsync({
      first: PAGE_SIZE,
      createdBefore: new Date(cursor),
      // Descending order.
      sortBy: [[MediaLibrary.SortBy.creationTime, false]],
      mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
      // Resolve full info. For images this gets the full EXIF data and can fix the orientation.
      resolveWithFullInfo: true,
    })
    if (page.assets.length === 0) {
      logger.info('syncPhotosArchive', 'fully_synced')
      await setPhotosArchiveCursor(0)
      return
    }
    logger.info('syncPhotosArchive', 'batch', { size: page.assets.length })
    const lastAssetCreationTime =
      page.assets[page.assets.length - 1].creationTime ?? 0
    const nextTimestamp = lastAssetCreationTime ? lastAssetCreationTime - 1 : 0
    await setPhotosArchiveCursor(nextTimestamp)
    const { files } = await processAssets(
      page.assets.map((asset) => ({
        id: asset.id,
        sourceUri: asset.uri,
        name: asset.filename,
        type: undefined,
        size: undefined,
        timestamp: new Date(asset.creationTime).toISOString(),
      })),
    )
    if (files.length > 0) {
      await invalidateCacheLibraryAllStats()
      invalidateCacheLibraryLists()
    } else {
      // Nothing was found so immediately start next interval.
      return 0
    }
  } catch (e) {
    logger.error('syncPhotosArchive', 'batch_error', { error: e as Error })
  }
}

export const { init: initSyncPhotosArchive } = createServiceInterval({
  name: 'syncPhotosArchive',
  worker: workBackward,
  getState: async () => getAutoSyncPhotosArchive(),
  interval: SYNC_PHOTOS_ARCHIVE_INTERVAL,
})

const defaultValue = 0

export const [
  getAutoSyncPhotosArchive,
  useAutoSyncPhotosArchive,
  autoSyncPhotosArchiveCache,
] = createGetterAndSWRHook<boolean>(() =>
  getAsyncStorageBoolean('autoSyncPhotosArchive', false),
)

export async function setAutoSyncPhotosArchive(value: boolean) {
  await setAsyncStorageBoolean('autoSyncPhotosArchive', value)
  await autoSyncPhotosArchiveCache.set(value)
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

export const [
  getPhotosArchiveCursor,
  usePhotosArchiveCursor,
  photosArchiveCursorCache,
] = createGetterAndSWRHook<number>(() =>
  getAsyncStorageNumber('photosArchiveCursor', defaultValue),
)

export async function setPhotosArchiveCursor(value: number) {
  await setAsyncStorageNumber('photosArchiveCursor', value)
  await photosArchiveCursorCache.set(value)
}

export async function restartPhotosArchiveCursor() {
  logger.info('syncPhotosArchive', 'cursor_restart')
  await setPhotosArchiveCursor(Date.now())
}

export async function resetPhotosArchiveCursor() {
  logger.info('syncPhotosArchive', 'cursor_disable')
  await setPhotosArchiveCursor(defaultValue)
}
