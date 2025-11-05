import * as MediaLibrary from 'expo-media-library'
import { logger } from '../lib/logger'
import { getKey, triggerChange } from '../stores/settings'
import { processAssets } from '../lib/processAssets'
import { librarySwr } from '../stores/library'
import { createGetterAndSWRHook } from '../lib/selectors'
import {
  getSecureStoreNumber,
  setSecureStoreNumber,
  getSecureStoreBoolean,
  setSecureStoreBoolean,
} from '../stores/secureStore'
import { createServiceInterval } from '../lib/serviceInterval'
import { SYNC_PHOTOS_ARCHIVE_INTERVAL } from '../config'
import { ensureMediaLibraryPermission } from '../lib/mediaLibraryPermissions'

const PAGE_SIZE = 1

export async function workBackward(): Promise<void> {
  if (!(await ensureMediaLibraryPermission())) return
  if (await getPhotosArchivePaused()) return
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
      logger.log('[syncPhotosArchive] archive is fully synced')
      await setPhotosArchiveCursor(0)
      return
    }
    logger.log('[syncPhotosArchive] batch size', page.assets.length)
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
      }))
    )
    if (files.length > 0) await librarySwr.triggerChange()
  } catch (e) {
    logger.log('[syncPhotosArchive] batch error', e)
  }
}

export const initSyncPhotosArchive = createServiceInterval({
  name: 'syncPhotosArchive',
  worker: workBackward,
  getState: async () =>
    (await getPhotosArchiveCursor()) > 0 && !(await getPhotosArchivePaused()),
  interval: SYNC_PHOTOS_ARCHIVE_INTERVAL,
})

const defaultValue = 0

export const [getPhotosArchiveCursor, usePhotosArchiveCursor] =
  createGetterAndSWRHook(getKey('photosArchiveCursor'), () =>
    getSecureStoreNumber('photosArchiveCursor', defaultValue)
  )

export async function setPhotosArchiveCursor(value: number) {
  await setSecureStoreNumber('photosArchiveCursor', value)
  triggerChange('photosArchiveCursor')
}

export async function restartPhotosArchiveCursor() {
  logger.log('[syncPhotosArchive] restarting photos archive sync cursor')
  await setPhotosArchiveCursor(Date.now())
}

export async function resetPhotosArchiveCursor() {
  logger.log('[syncPhotosArchive] disabling photos archive sync cursor')
  await setPhotosArchiveCursor(defaultValue)
}

// Paused state.

export const [getPhotosArchivePaused, usePhotosArchivePaused] =
  createGetterAndSWRHook(getKey('photosArchivePaused'), () =>
    getSecureStoreBoolean('photosArchivePaused', false)
  )

export async function setPhotosArchivePaused(value: boolean) {
  await setSecureStoreBoolean('photosArchivePaused', value)
  triggerChange('photosArchivePaused')
}

export async function pausePhotosArchive() {
  await setPhotosArchivePaused(true)
}

export async function resumePhotosArchive() {
  await setPhotosArchivePaused(false)
}
