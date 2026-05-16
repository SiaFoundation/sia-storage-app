import type { ResolveLocalIdResult } from '@siastorage/core/services/importScanner'
import { logger } from '@siastorage/logger'
import * as MediaLibrary from 'expo-media-library'

const resolved = (uri: string): ResolveLocalIdResult => ({ status: 'resolved', uri })
const deleted: ResolveLocalIdResult = { status: 'deleted' }
const unavailable: ResolveLocalIdResult = { status: 'unavailable' }

/**
 * Resolve a media library local ID to a file URI.
 *
 * On iOS, getAssetInfoAsync with shouldDownloadFromNetwork triggers an
 * iCloud download for assets not cached locally. This can fail with
 * network errors, ExportSessionFailedException (slow-mo/edited videos),
 * or return an asset with null localUri when content isn't available
 * yet. We distinguish "temporarily unavailable" from "permanently
 * deleted" so the import scanner doesn't mark iCloud files as lost.
 *
 * On Android, getAssetInfoAsync only queries MediaStore — the options
 * parameter is ignored and no network download occurs. localUri is
 * only set when ExifInterface can read the file on disk (images only),
 * so cloud-only files (Google Photos "Free up space") return with
 * localUri undefined and we return unavailable. This is an
 * expo-media-library limitation — it uses file:// paths from the
 * deprecated DATA column instead of content:// URIs that could
 * trigger an on-demand download via ContentResolver.
 *
 * The three return states drive the import scanner's behavior:
 * - resolved: file is available, proceed with copy and hash
 * - unavailable: file exists but can't be accessed right now, skip
 *   without marking as lost (retry on next scan)
 * - deleted: file is gone from the device, mark as lost
 *
 * Suspension signal policy: does NOT accept a signal. Wraps a single
 * native MediaLibrary.getAssetInfoAsync call (which itself may invoke
 * an iCloud download on iOS). The native work runs to completion and
 * can't be cancelled from JS. Callers that loop should check their
 * signal at the loop boundary before invoking.
 */
export async function getMediaLibraryUri(localId: string | null): Promise<ResolveLocalIdResult> {
  if (!localId) return deleted
  try {
    const asset = await MediaLibrary.getAssetInfoAsync(localId, {
      shouldDownloadFromNetwork: true,
    })
    if (!asset) {
      logger.debug('mediaLibrary', 'asset_deleted', { localId })
      return deleted
    }
    const uri = normalizeUri(asset.localUri)
    if (uri) return resolved(uri)
    // Asset exists but localUri is null — iCloud content that hasn't
    // finished downloading or can't be exported.
    logger.debug('mediaLibrary', 'asset_no_local_uri', { localId })
    return unavailable
  } catch (e) {
    // The download/export threw. Retry without download to distinguish
    // "asset exists but is inaccessible" from "asset was deleted."
    logger.debug('mediaLibrary', 'asset_info_failed', {
      localId,
      error: e as Error,
    })
    try {
      const check = await MediaLibrary.getAssetInfoAsync(localId, {
        shouldDownloadFromNetwork: false,
      })
      return check ? unavailable : deleted
    } catch (fallbackError) {
      logger.debug('mediaLibrary', 'asset_info_fallback_failed', {
        localId,
        error: fallbackError as Error,
      })
      return deleted
    }
  }
}

/**
 * Resolve a media library local ID to a URI a player can render.
 *
 * Two-step: first request with shouldDownloadFromNetwork to materialize
 * a real file:// localUri (pulls iCloud-only assets on demand). If that
 * throws or returns no localUri, retry without download and fall back to
 * asset.uri (ph:// on iOS, file:// on Android).
 *
 * The eager step is what restores iOS image preview during import for
 * iCloud-only photos. RN's stock <Image> (which ImageZoom wraps as
 * Animated.Image) has no ph:// URL loader registered, so it needs a
 * real file:// — libraries like expo-image / react-native-fast-image
 * ship a PHAsset loader and would accept ph:// directly, but we don't
 * use them today. The ph:// fallback below is what still unblocks
 * slow-mo / HEVC / iCloud videos on iOS where AVAssetExportSession
 * throws, and any video on Android where expo-media-library's
 * ExifInterface path is image-only. Video players resolve ph:// directly
 * via PHImageManager.
 *
 * Display only. ph:// has no readable bytes, so do not use this for
 * hashing, copying, sharing, or upload — getMediaLibraryUri (above) is
 * the function for that.
 */
export async function getMediaLibraryDisplayUri(
  localId: string | null,
): Promise<ResolveLocalIdResult> {
  if (!localId) return deleted
  try {
    return resolveAssetDisplay(
      await MediaLibrary.getAssetInfoAsync(localId, { shouldDownloadFromNetwork: true }),
    )
  } catch {
    return resolveAssetDisplay(
      await MediaLibrary.getAssetInfoAsync(localId, {
        shouldDownloadFromNetwork: false,
      }).catch(() => null),
    )
  }
}

function resolveAssetDisplay(asset: MediaLibrary.AssetInfo | null): ResolveLocalIdResult {
  if (!asset) return deleted
  const uri = normalizeUri(asset.localUri) ?? asset.uri ?? null
  return uri ? resolved(uri) : unavailable
}

/**
 * Normalize the URI for a file. Remove the hash index if it exists.
 * This is necessary because the MediaLibrary.getAssetInfoAsync() sometimes
 * returns a URI with a hash index that is not valid for the File system API.
 */
function normalizeUri(uri: string | null | undefined): string | null {
  if (!uri) return null
  const hashIndex = uri.indexOf('#')
  return hashIndex >= 0 ? uri.slice(0, hashIndex) : uri
}
