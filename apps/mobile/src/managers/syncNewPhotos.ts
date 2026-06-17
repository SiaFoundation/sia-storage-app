/*
 * syncNewPhotos — imports photos added to the library since the feature was
 * enabled, while the app is foregrounded.
 *
 * On enable we anchor a media-observer cursor at the current library state. Each
 * tick we import the asset ids it reports as added since the stored cursor, then
 * advance the cursor. Detection is by what the system actually added, so an
 * old-dated photo just AirDropped/iCloud-synced, or an Android file with no
 * capture date, is caught where a creationTime scan would miss it, and metadata
 * bumps on existing photos are ignored. Historic photos are the archive's job.
 *
 * The cursor lives in one storage key (same name on both platforms); the native
 * module is stateless.
 */

import { useApp } from '@siastorage/core/app'
import { SYNC_NEW_PHOTOS_INTERVAL } from '@siastorage/core/config'
import { createServiceInterval } from '@siastorage/core/lib/serviceInterval'
import { logger } from '@siastorage/logger'
import * as MediaLibrary from 'expo-media-library'
import * as mediaObserver from 'media-observer'
import useSWR from 'swr'
import { syncAssets } from '../lib/assetImports'
import {
  ensureMediaLibraryPermission,
  getMediaLibraryPermissions,
  mediaLibraryPermissionsCache,
} from '../lib/mediaLibraryPermissions'
import { app } from '../stores/appService'

const CURSOR_KEY = 'syncNewPhotosCursor'

export async function run(signal?: AbortSignal): Promise<void> {
  if (!(await getAutoSyncNewPhotos())) return
  if (!(await getMediaLibraryPermissions())) return
  // Hold off while the initial sync window is active, for resource coordination.
  if (app().sync.getState().syncGateStatus === 'active') return
  if (signal?.aborted) return

  try {
    const { inserted, cursor } = await mediaObserver.changesSince(await getCursor())
    if (signal?.aborted) return

    const assets = await resolveAssets(inserted)
    if (signal?.aborted) return
    if (assets.length > 0) {
      logger.info('syncNewPhotos', 'import', { count: assets.length })
      await ingest(assets, signal)
      if (signal?.aborted) return
    }
    // Advance only after a durable ingest, so a thrown/aborted tick replays the
    // same ids next time. syncAssets dedups by asset id then content hash.
    await setCursor(cursor)
  } catch (e) {
    logger.error('syncNewPhotos', 'tick_failed', { error: e as Error })
  }
}

// Resolve detected ids to library assets, dropping any deleted between detection
// and now. shouldDownloadFromNetwork:false avoids pulling full-resolution bytes
// for iCloud assets here; syncAssets pulls bytes on demand for dedup survivors.
async function resolveAssets(ids: string[]): Promise<MediaLibrary.AssetInfo[]> {
  const resolved = await Promise.all(
    ids.map((id) =>
      MediaLibrary.getAssetInfoAsync(id, { shouldDownloadFromNetwork: false }).catch(() => null),
    ),
  )
  return resolved.filter((a): a is MediaLibrary.AssetInfo => a !== null && a !== undefined)
}

async function ingest(assets: MediaLibrary.Asset[], signal?: AbortSignal): Promise<void> {
  const { files } = await syncAssets(
    assets.map((asset) => ({
      id: asset.id,
      sourceUri: asset.uri,
      name: asset.filename,
      type: undefined,
      size: undefined,
      // Fall back to modificationTime when creationTime is 0 — Android files with
      // no capture date (the case the cursor newly catches) would otherwise be
      // stamped 1970. Matches the archive walk.
      timestamp: new Date(asset.creationTime || asset.modificationTime).toISOString(),
    })),
    'file',
    { addToImportDirectory: true, skipExistingUpdates: true },
    signal,
  )
  if (files.length > 0) {
    await app().caches.library.invalidateAll()
    app().caches.libraryVersion.invalidate()
  }
}

async function getCursor(): Promise<string | null> {
  const raw = await app().storage.getItem(CURSOR_KEY)
  return raw === null || raw === '' ? null : raw
}

async function setCursor(cursor: string): Promise<void> {
  await app().storage.setItem(CURSOR_KEY, cursor)
}

export const { init: initSyncNewPhotos } = createServiceInterval({
  name: 'syncNewPhotos',
  worker: run,
  interval: SYNC_NEW_PHOTOS_INTERVAL,
})

export async function getAutoSyncNewPhotos(): Promise<boolean> {
  return (await app().storage.getItem('autoSyncNewPhotos')) === 'true'
}

export function useAutoSyncNewPhotos() {
  const app = useApp()
  return useSWR(app.caches.settings.key('autoSyncNewPhotos'), () => getAutoSyncNewPhotos())
}

export async function setAutoSyncNewPhotos(value: boolean) {
  await app().storage.setItem('autoSyncNewPhotos', String(value))
  app().caches.settings.invalidate('autoSyncNewPhotos')
  if (value) {
    // Anchor at enable-time so only later additions import; re-enabling re-anchors.
    await setCursor(await mediaObserver.currentCursor())
    ensureMediaLibraryPermission()
  }
  mediaLibraryPermissionsCache.invalidate()
}

export async function toggleAutoSyncNewPhotos() {
  await setAutoSyncNewPhotos(!(await getAutoSyncNewPhotos()))
}
