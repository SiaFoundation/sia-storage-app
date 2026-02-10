import * as MediaLibrary from 'expo-media-library'
import { SYNC_NEW_PHOTOS_INTERVAL } from '../config'
import { logger } from '../lib/logger'
import {
  ensureMediaLibraryPermission,
  getMediaLibraryPermissions,
  mediaLibraryPermissionsSwr,
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
import { librarySwr } from '../stores/library'
import { settingsSwr } from '../stores/settings'

const PAGE_SIZE = 200

async function workForward(): Promise<void> {
  logger.debug('syncNewPhotos', 'tick')
  if (!(await getMediaLibraryPermissions())) return
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
    if (page.assets.length === 0) {
      logger.debug('syncNewPhotos', 'no_new_photos')
      return
    }
    logger.info('syncNewPhotos', 'batch', { size: page.assets.length })
    const lastAssetCreationTime =
      page.assets[page.assets.length - 1].creationTime
    const nextTimestamp = lastAssetCreationTime ? lastAssetCreationTime + 1 : 0
    await setPhotosNewCursor(nextTimestamp)
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
    if (files.length > 0) await librarySwr.triggerChange()
  } catch (e) {
    logger.error('syncNewPhotos', 'batch_error', { error: e as Error })
  }
}

export const initSyncNewPhotos = createServiceInterval({
  name: 'syncNewPhotos',
  worker: workForward,
  getState: () => getAutoSyncNewPhotos(),
  interval: SYNC_NEW_PHOTOS_INTERVAL,
})

// Photos sync - new photos forward cursor and toggle.

export const [getAutoSyncNewPhotos, useAutoSyncNewPhotos] =
  createGetterAndSWRHook(settingsSwr.getKey('autoSyncNewPhotos'), () =>
    getAsyncStorageBoolean('autoSyncNewPhotos', false),
  )

export async function setAutoSyncNewPhotos(value: boolean) {
  await setAsyncStorageBoolean('autoSyncNewPhotos', value)
  settingsSwr.triggerChange('autoSyncNewPhotos')
  if (value) {
    ensureMediaLibraryPermission()
  }
  mediaLibraryPermissionsSwr.triggerChange()
}

export async function toggleAutoSyncNewPhotos() {
  const current = await getAutoSyncNewPhotos()
  const next = !current
  await setAutoSyncNewPhotos(next)
}

const defaultValue = Date.now()

export const [getPhotosNewCursor, usePhotosNewCursor] = createGetterAndSWRHook(
  settingsSwr.getKey('photosNewCursor'),
  () => getAsyncStorageNumber('photosNewCursor', defaultValue),
)

export async function setPhotosNewCursor(value: number) {
  await setAsyncStorageNumber('photosNewCursor', value)
  settingsSwr.triggerChange('photosNewCursor')
}

export async function resetPhotosNewCursor() {
  logger.info('syncNewPhotos', 'cursor_reset')
  await setPhotosNewCursor(defaultValue)
}
