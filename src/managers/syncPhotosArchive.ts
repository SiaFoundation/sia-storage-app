import * as MediaLibrary from 'expo-media-library'
import { serviceLog } from '../lib/logger'
import { settingsSwr } from '../stores/settings'
import { processAssets } from '../lib/processAssets'
import { librarySwr } from '../stores/library'
import { createGetterAndSWRHook } from '../lib/selectors'
import {
  getAsyncStorageNumber,
  setAsyncStorageNumber,
  getAsyncStorageBoolean,
  setAsyncStorageBoolean,
} from '../stores/asyncStore'
import { createServiceInterval } from '../lib/serviceInterval'
import { SYNC_PHOTOS_ARCHIVE_INTERVAL } from '../config'
import {
  ensureMediaLibraryPermission,
  getMediaLibraryPermissions,
  mediaLibraryPermissionsSwr,
} from '../lib/mediaLibraryPermissions'

const PAGE_SIZE = 1

export async function workBackward() {
  if (!(await getMediaLibraryPermissions())) return
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
      serviceLog('[syncPhotosArchive] archive is fully synced')
      await setPhotosArchiveCursor(0)
      return
    }
    serviceLog('[syncPhotosArchive] batch size', page.assets.length)
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
    if (files.length > 0) {
      await librarySwr.triggerChange()
    } else {
      // Nothing was found so immediately start next interval.
      return 0
    }
  } catch (e) {
    serviceLog('[syncPhotosArchive] batch error', e)
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
    getAsyncStorageBoolean('autoSyncPhotosArchive', false)
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
    getAsyncStorageNumber('photosArchiveCursor', defaultValue)
  )

export async function setPhotosArchiveCursor(value: number) {
  await setAsyncStorageNumber('photosArchiveCursor', value)
  settingsSwr.triggerChange('photosArchiveCursor')
}

export async function restartPhotosArchiveCursor() {
  serviceLog('[syncPhotosArchive] restarting photos archive sync cursor')
  await setPhotosArchiveCursor(Date.now())
}

export async function resetPhotosArchiveCursor() {
  serviceLog('[syncPhotosArchive] disabling photos archive sync cursor')
  await setPhotosArchiveCursor(defaultValue)
}
