import * as MediaLibrary from 'expo-media-library'
import { SYNC_PHOTOS_ARCHIVE_INTERVAL } from '../config'
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
import { getFileCountLocal } from '../stores/files'
import { librarySwr } from '../stores/library'
import { settingsSwr } from '../stores/settings'

const PAGE_SIZE = 50

export async function workBackward() {
  logger.debug('syncPhotosArchive', 'tick')
  if (!(await getMediaLibraryPermissions())) return
  const localOnlyCount = await getFileCountLocal({ localOnly: true })
  if (localOnlyCount > 0) {
    logger.info('syncPhotosArchive', 'skipped', {
      reason: 'local_only_pending',
      localOnlyCount,
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
      await librarySwr.triggerChange()
    } else {
      // Nothing was found so immediately start next interval.
      return 0
    }
  } catch (e) {
    logger.error('syncPhotosArchive', 'batch_error', { error: e as Error })
  }
}

export const initSyncPhotosArchive = createServiceInterval({
  name: 'syncPhotosArchive',
  worker: workBackward,
  getState: async () => getAutoSyncPhotosArchive(),
  interval: SYNC_PHOTOS_ARCHIVE_INTERVAL,
})

const defaultValue = 0

export const [getAutoSyncPhotosArchive, useAutoSyncPhotosArchive] =
  createGetterAndSWRHook(settingsSwr.getKey('autoSyncPhotosArchive'), () =>
    getAsyncStorageBoolean('autoSyncPhotosArchive', false),
  )

export async function setAutoSyncPhotosArchive(value: boolean) {
  await setAsyncStorageBoolean('autoSyncPhotosArchive', value)
  settingsSwr.triggerChange('autoSyncPhotosArchive')
  if (value) {
    ensureMediaLibraryPermission()
  }
  mediaLibraryPermissionsSwr.triggerChange()
}

export async function toggleAutoSyncPhotosArchive() {
  const current = await getAutoSyncPhotosArchive()
  const next = !current
  await setAutoSyncPhotosArchive(next)
}

export const [getPhotosArchiveCursor, usePhotosArchiveCursor] =
  createGetterAndSWRHook(settingsSwr.getKey('photosArchiveCursor'), () =>
    getAsyncStorageNumber('photosArchiveCursor', defaultValue),
  )

export async function setPhotosArchiveCursor(value: number) {
  await setAsyncStorageNumber('photosArchiveCursor', value)
  settingsSwr.triggerChange('photosArchiveCursor')
}

export async function restartPhotosArchiveCursor() {
  logger.info('syncPhotosArchive', 'cursor_restart')
  await setPhotosArchiveCursor(Date.now())
}

export async function resetPhotosArchiveCursor() {
  logger.info('syncPhotosArchive', 'cursor_disable')
  await setPhotosArchiveCursor(defaultValue)
}
