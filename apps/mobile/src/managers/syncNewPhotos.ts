/*
 * syncNewPhotos — imports photos added to the library since the feature was
 * enabled, while the app is foregrounded.
 *
 * On enable we anchor a media-observer cursor at the current library state.
 * Each tick feeds the asset ids reported as added since the stored cursor
 * into the open new-photos import, then advances the cursor. Detection is by
 * what the system actually added, so an old-dated photo that was AirDropped
 * or iCloud-synced in, or an Android file with no capture date, is caught
 * where a creationTime scan would miss it, and metadata bumps on existing
 * photos are ignored. Historic photos are the archive walk's job.
 *
 * The cursor lives in one storage key (same name on both platforms); the native
 * module is stateless.
 */

import { useApp } from '@siastorage/core/app'
import { IMPORT_IDLE_SEAL_MS, SYNC_NEW_PHOTOS_INTERVAL } from '@siastorage/core/config'
import type { ImportRow } from '@siastorage/core/db/operations'
import { createServiceInterval } from '@siastorage/core/lib/serviceInterval'
import { uniqueId } from '@siastorage/core/lib/uniqueId'
import { logger } from '@siastorage/logger'
import * as MediaLibrary from 'expo-media-library'
import * as mediaObserver from 'media-observer'
import useSWR from 'swr'
import { buildPhotoCandidateRows, resolveImportDirectoryId } from '../lib/assetImports'
import {
  ensureMediaLibraryPermission,
  getMediaLibraryPermissions,
  mediaLibraryPermissionsCache,
} from '../lib/mediaLibraryPermissions'
import { app } from '../stores/appService'
import { triggerImportScanner } from './importScanner'

const CURSOR_KEY = 'syncNewPhotosCursor'

export async function run(signal?: AbortSignal): Promise<void> {
  if (!(await getAutoSyncNewPhotos())) {
    logger.debug('syncNewPhotos', 'skipped', { reason: 'disabled' })
    return
  }
  if (!(await getMediaLibraryPermissions())) {
    logger.debug('syncNewPhotos', 'skipped', { reason: 'no_permission' })
    return
  }
  // Hold off ingesting new camera-roll photos while the initial sync gate is
  // active, purely for resource coordination.
  if (app().sync.getState().syncGateStatus === 'active') {
    logger.debug('syncNewPhotos', 'skipped', { reason: 'sync_gate_active' })
    return
  }
  if (signal?.aborted) return

  try {
    // Seal the open import once no asset has been added for IMPORT_IDLE_SEAL_MS
    // (measured against imports.updatedAt, bumped by create/addFiles). Sealing
    // on idle rather than on the first empty poll survives steady-drip capture:
    // a photo every ~11s would otherwise never see an empty poll. Seals every
    // idle new-photos open import.
    const now = Date.now()
    await app().imports.sealIdle('new-photos', IMPORT_IDLE_SEAL_MS, now)

    const { inserted, cursor } = await withTimeout(
      mediaObserver.changesSince(await getCursor()),
      NATIVE_CALL_TIMEOUT_MS,
    )
    if (signal?.aborted) return

    const assets = await resolveAssets(inserted)
    if (signal?.aborted) return
    if (assets.length > 0) {
      const directoryId = await resolveImportDirectoryId()
      // Used only when appendToOpenImport creates (no in-progress new-photos
      // import exists); on append or wait it is ignored.
      const newImport: ImportRow = {
        id: uniqueId(),
        source: 'new-photos',
        directoryId,
        pendingTags: null,
        expectedCount: 0, // overwritten to rows.length below, before the create/append call
        dedupByHash: 1,
        dirSourceRef: null,
        sealed: 0,
        startedAt: now,
        updatedAt: now,
      }
      // Resolve the importId for the candidate rows up front. On append, the
      // rows are re-pointed at the open import inside the transaction; on
      // create, they keep this id.
      const rows = await buildPhotoCandidateRows(
        assets.map((asset) => ({
          id: asset.id,
          sourceUri: asset.uri,
          name: asset.filename,
          type: undefined,
          size: undefined,
          // Fall back to modificationTime when creationTime is 0; an Android
          // file with no capture date would otherwise be stamped 1970.
          // Matches the archive walk.
          timestamp: new Date(asset.creationTime || asset.modificationTime).toISOString(),
        })),
        newImport.id,
        directoryId,
        now,
      )
      if (signal?.aborted) return
      if (rows.length > 0) {
        newImport.expectedCount = rows.length
        const result = await app().imports.appendToOpenImport('new-photos', newImport, rows, now)
        logger.info('syncNewPhotos', 'batch', {
          action: result.action,
          importId: result.importId,
          candidates: rows.length,
          detected: assets.length,
        })
        // On 'waited' the open import is sealed but still draining and nothing
        // landed: leave the cursor so the same ids replay next tick
        // (buildPhotoCandidateRows dedups by asset id, so the replay is
        // idempotent).
        if (result.action === 'waited') return
        triggerImportScanner()
      } else {
        logger.debug('syncNewPhotos', 'no_new_candidates')
      }
    }
    // A detected id that didn't resolve is not treated as deleted: it's a
    // mid-scan IS_PENDING row or a transient Photos-DB error
    // (getAssetInfoAsync can't see pending rows and returns null). Advancing
    // here would skip the photo forever; hold the cursor so the id replays.
    // Truly deleted rows drop out of changesSince on their own, and replays
    // are idempotent via the asset-id dedup.
    if (assets.length < inserted.length) {
      logger.warn('syncNewPhotos', 'unresolved_held', {
        dropped: inserted.length - assets.length,
      })
      return
    }
    // Advance only after the survivors are durably in import_files (or there
    // were none), so a thrown, aborted, or waited tick replays the same ids
    // next time.
    await setCursor(cursor)
  } catch (e) {
    logger.error('syncNewPhotos', 'tick_failed', { error: e as Error })
  }
}

// Resolve detected ids to library assets. A null or thrown resolve is treated
// as transient (pending row, Photos-DB hiccup); the caller holds the cursor
// so the id replays. shouldDownloadFromNetwork:false avoids pulling
// full-resolution bytes for iCloud assets here; the import scanner pulls
// bytes on demand for dedup survivors.
async function resolveAssets(ids: string[]): Promise<MediaLibrary.AssetInfo[]> {
  const resolved = await Promise.all(
    ids.map((id) =>
      withTimeout(
        MediaLibrary.getAssetInfoAsync(id, { shouldDownloadFromNetwork: false }),
        NATIVE_CALL_TIMEOUT_MS,
      ).catch(() => null),
    ),
  )
  return resolved.filter((a): a is MediaLibrary.AssetInfo => a !== null && a !== undefined)
}

// The scheduler reschedules only after the worker settles, so one native call
// that never resolves (a MediaStore/Photos query can hang) would silently stop
// this sync until the next app launch. A timed-out call rejects instead; the
// tick's existing transient-failure policy holds the cursor and replays.
const NATIVE_CALL_TIMEOUT_MS = 20_000

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

async function getCursor(): Promise<string | null> {
  const raw = await app().storage.getItem(CURSOR_KEY)
  return raw === null || raw === '' ? null : raw
}

async function setCursor(cursor: string): Promise<void> {
  await app().storage.setItem(CURSOR_KEY, cursor)
}

const { init: initSyncNewPhotosInterval } = createServiceInterval({
  name: 'syncNewPhotos',
  worker: run,
  interval: SYNC_NEW_PHOTOS_INTERVAL,
})

/**
 * Seal any new-photos open import left unsealed by a previous run (idleMs=0
 * seals every open import whose updatedAt is in the past), then start the
 * poll interval. A burst never spans a restart; its photos re-detect into the
 * next open import.
 */
export function initSyncNewPhotos(): void {
  void app()
    .imports.sealIdle('new-photos', 0, Date.now())
    .catch((e) => logger.error('syncNewPhotos', 'seal_leftover_error', { error: e as Error }))
  initSyncNewPhotosInterval()
}

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
