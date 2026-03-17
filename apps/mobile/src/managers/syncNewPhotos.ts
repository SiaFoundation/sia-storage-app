/*
 * syncNewPhotos — polls every 10s, fetches 1 page of 50 photos.
 *
 * Runs in the foreground while the user is active. Kept lightweight
 * (small page, longer interval) to minimize jank. Only processes
 * photos with modificationTime >= enabledAt so that historic photos
 * don't appear unexpectedly — the archive handles the backfill.
 * As time passes, the enabledAt floor stays fixed so the window of
 * "new" photos grows naturally.
 *
 * Catches: newly taken photos and recently modified photos near the
 * top of the sorted list. The deep historical tail and periodic
 * re-scans for cross-device synced photos are handled by
 * syncPhotosArchive (which runs its bounded re-scan during background
 * tasks where heavier DB work is free).
 *
 * Sorts by modificationTime DESC because:
 * - Android: DATE_TAKEN can be NULL for imported/downloaded photos,
 *   silently excluding them from createdAfter/createdBefore queries.
 * - iOS: creationDate can be an old EXIF date; modificationDate is the
 *   iCloud-synced metadata timestamp (not local arrival time).
 */

import { useApp } from '@siastorage/core/app'
import { SYNC_NEW_PHOTOS_INTERVAL } from '@siastorage/core/config'
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

const PAGE_SIZE = 50

export async function workNew(signal?: AbortSignal): Promise<void> {
  logger.debug('syncNewPhotos', 'tick')
  if (!(await getMediaLibraryPermissions())) return
  if (signal?.aborted) return
  const enabledAt = await getSyncNewPhotosEnabledAt()

  try {
    const page = await MediaLibrary.getAssetsAsync({
      first: PAGE_SIZE,
      sortBy: [[MediaLibrary.SortBy.modificationTime, false]],
      mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
    })
    if (signal?.aborted) return
    const assets = page.assets.filter((a) => a.modificationTime >= enabledAt)
    if (assets.length === 0) {
      logger.debug('syncNewPhotos', 'no_new_photos')
      return
    }

    logger.info('syncNewPhotos', 'batch', {
      assets: assets.length,
      totalOnPage: page.assets.length,
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
      { addToImportDirectory: true, skipExistingUpdates: true },
    )
    if (files.length > 0) {
      await app().caches.library.invalidateAll()
      app().caches.libraryVersion.invalidate()
    }
  } catch (e) {
    logger.error('syncNewPhotos', 'batch_error', {
      error: e as Error,
    })
  }
}

export const { init: initSyncNewPhotos } = createServiceInterval({
  name: 'syncNewPhotos',
  worker: workNew,
  getState: () => getAutoSyncNewPhotos(),
  interval: SYNC_NEW_PHOTOS_INTERVAL,
})

export async function getAutoSyncNewPhotos(): Promise<boolean> {
  const raw = await app().storage.getItem('autoSyncNewPhotos')
  return raw === null ? false : raw === 'true'
}

export function useAutoSyncNewPhotos() {
  const app = useApp()
  return useSWR(app.caches.settings.key('autoSyncNewPhotos'), () =>
    getAutoSyncNewPhotos(),
  )
}

export async function setAutoSyncNewPhotos(value: boolean) {
  await app().storage.setItem('autoSyncNewPhotos', String(value))
  app().caches.settings.invalidate('autoSyncNewPhotos')
  if (value) {
    await setSyncNewPhotosEnabledAt(Date.now())
    ensureMediaLibraryPermission()
  }
  mediaLibraryPermissionsCache.invalidate()
}

export async function toggleAutoSyncNewPhotos() {
  const current = await getAutoSyncNewPhotos()
  const next = !current
  await setAutoSyncNewPhotos(next)
}

export async function getSyncNewPhotosEnabledAt(): Promise<number> {
  const raw = await app().storage.getItem('syncNewPhotosEnabledAt')
  const n = raw ? Number(raw) : 0
  return Number.isFinite(n) ? n : 0
}

export async function setSyncNewPhotosEnabledAt(value: number) {
  await app().storage.setItem('syncNewPhotosEnabledAt', String(value))
  app().caches.settings.invalidate('syncNewPhotosEnabledAt')
}
