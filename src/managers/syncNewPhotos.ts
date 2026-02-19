import * as MediaLibrary from 'expo-media-library'
import { SYNC_NEW_PHOTOS_INTERVAL } from '../config'
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
import {
  invalidateCacheLibraryAllStats,
  invalidateCacheLibraryLists,
} from '../stores/librarySwr'

const PAGE_SIZE = 200

async function workForward(signal: AbortSignal): Promise<void> {
  logger.debug('syncNewPhotos', 'tick')
  if (!(await getMediaLibraryPermissions())) return
  if (signal.aborted) return
  const cursor = await getPhotosNewCursor()

  try {
    const page = await MediaLibrary.getAssetsAsync({
      first: PAGE_SIZE,
      createdAfter: new Date(cursor),
      // Ascending order.
      sortBy: [[MediaLibrary.SortBy.creationTime, true]],
      mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
      // Resolve full info. For images this gets the full EXIF data and can fix the orientation.
      resolveWithFullInfo: true,
    })
    if (signal.aborted) return
    if (page.assets.length === 0) {
      logger.debug('syncNewPhotos', 'no_new_photos')
      return
    }
    logger.info('syncNewPhotos', 'batch', { size: page.assets.length })
    const lastAssetCreationTime =
      page.assets[page.assets.length - 1].creationTime
    const nextTimestamp = lastAssetCreationTime ? lastAssetCreationTime + 1 : 0
    await setPhotosNewCursor(nextTimestamp)
    if (signal.aborted) return
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
    }
  } catch (e) {
    logger.error('syncNewPhotos', 'batch_error', { error: e as Error })
  }
}

export const { init: initSyncNewPhotos } = createServiceInterval({
  name: 'syncNewPhotos',
  worker: workForward,
  getState: () => getAutoSyncNewPhotos(),
  interval: SYNC_NEW_PHOTOS_INTERVAL,
})

// Photos sync - new photos forward cursor and toggle.

export const [
  getAutoSyncNewPhotos,
  useAutoSyncNewPhotos,
  autoSyncNewPhotosCache,
] = createGetterAndSWRHook<boolean>(() =>
  getAsyncStorageBoolean('autoSyncNewPhotos', false),
)

export async function setAutoSyncNewPhotos(value: boolean) {
  await setAsyncStorageBoolean('autoSyncNewPhotos', value)
  await autoSyncNewPhotosCache.set(value)
  if (value) {
    ensureMediaLibraryPermission()
  }
  mediaLibraryPermissionsCache.invalidate()
}

export async function toggleAutoSyncNewPhotos() {
  const current = await getAutoSyncNewPhotos()
  const next = !current
  await setAutoSyncNewPhotos(next)
}

const defaultValue = Date.now()

export const [getPhotosNewCursor, usePhotosNewCursor, photosNewCursorCache] =
  createGetterAndSWRHook<number>(() =>
    getAsyncStorageNumber('photosNewCursor', defaultValue),
  )

export async function setPhotosNewCursor(value: number) {
  await setAsyncStorageNumber('photosNewCursor', value)
  await photosNewCursorCache.set(value)
}

export async function resetPhotosNewCursor() {
  logger.info('syncNewPhotos', 'cursor_reset')
  await setPhotosNewCursor(defaultValue)
}
