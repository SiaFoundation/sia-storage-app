import * as MediaLibrary from 'expo-media-library'
import { logger } from '../lib/logger'
import { createServiceInterval } from '../lib/serviceInterval'
import { getKey, triggerChange } from '../stores/settings'
import { processAssets } from '../lib/processAssets'
import { librarySwr } from '../stores/library'
import { SYNC_NEW_PHOTOS_INTERVAL } from '../config'
import { createGetterAndSWRHook } from '../lib/selectors'
import {
  getSecureStoreBoolean,
  getSecureStoreNumber,
  setSecureStoreBoolean,
  setSecureStoreNumber,
} from '../stores/secureStore'
import { ensurePhotosPermission } from '../lib/permissions'

const PAGE_SIZE = 200

async function workForward(): Promise<void> {
  if (!(await ensurePhotosPermission())) return
  const cursor = await getPhotosNewCursor()

  try {
    const page = await MediaLibrary.getAssetsAsync({
      first: PAGE_SIZE,
      createdAfter: new Date(cursor),
      // Ascending order.
      sortBy: [[MediaLibrary.SortBy.creationTime, true]],
      mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
    })
    if (page.assets.length === 0) {
      logger.log('[syncNewPhotos] no new photos found')
      return
    }
    logger.log('[syncNewPhotos] batch size', page.assets.length)
    await setPhotosNewCursor(
      page.assets[page.assets.length - 1].creationTime ?? 0
    )
    const { files } = await processAssets(
      page.assets.map((asset) => ({
        id: asset.id,
        sourceUri: asset.uri,
        name: asset.filename,
        type: undefined,
        size: undefined,
        timestamp: new Date(asset.creationTime).toISOString(),
      }))
    )
    if (files.length > 0) await librarySwr.triggerChange()
  } catch (e) {
    logger.log('[syncNewPhotos] batch error', e)
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
  createGetterAndSWRHook(getKey('autoSyncNewPhotos'), () =>
    getSecureStoreBoolean('autoSyncNewPhotos', true)
  )

export async function setAutoSyncNewPhotos(value: boolean) {
  await setSecureStoreBoolean('autoSyncNewPhotos', value)
  triggerChange('autoSyncNewPhotos')
}

export async function toggleAutoSyncNewPhotos() {
  const current = await getAutoSyncNewPhotos()
  const next = !current
  await setAutoSyncNewPhotos(next)
}

const defaultValue = new Date().getTime()

export const [getPhotosNewCursor, usePhotosNewCursor] = createGetterAndSWRHook(
  getKey('photosNewCursor'),
  () => getSecureStoreNumber('photosNewCursor', defaultValue)
)

export async function setPhotosNewCursor(value: number) {
  await setSecureStoreNumber('photosNewCursor', value)
  triggerChange('photosNewCursor')
}

export async function resetPhotosNewCursor() {
  logger.log('[syncNewPhotos] resetting photos new sync cursor')
  await setPhotosNewCursor(defaultValue)
}
