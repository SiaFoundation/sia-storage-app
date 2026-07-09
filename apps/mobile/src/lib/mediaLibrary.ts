import type { ResolveSourceResult } from '@siastorage/core/services/importScanner'
import { logger } from '@siastorage/logger'
import * as MediaLibrary from 'expo-media-library'
import { Platform } from 'react-native'

const resolved = (uri: string): ResolveSourceResult => ({ status: 'resolved', uri })
const deleted: ResolveSourceResult = { status: 'deleted' }
const unavailable: ResolveSourceResult = { status: 'unavailable' }

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
 * On Android, getAssetInfoAsync only queries MediaStore. The options
 * parameter is ignored and no network download occurs. localUri is
 * only set via the image-only ExifInterface branch (videos never get
 * it), while asset.uri is usually the file:// path from MediaStore's
 * DATA column but can be a content:// provider uri, so the fallback
 * to asset.uri is scheme-guarded. Bytes can still be absent behind
 * that path (Google Photos "Free up space"); that surfaces as a copy
 * failure instead of a resolve failure.
 *
 * The three return states drive the import scanner's behavior:
 * - resolved: file is available, proceed with copy and hash
 * - unavailable: file exists but can't be accessed right now; the scanner
 *   records a transient failure and retries on the row's backoff schedule
 * - deleted: the asset row is verifiably gone (null return); never set on
 *   fetch errors, so a transient Photos-DB failure can't permanently mark
 *   a row lost
 *
 * Suspension signal policy: does NOT accept a signal. Wraps a single
 * native MediaLibrary.getAssetInfoAsync call (which itself may invoke
 * an iCloud download on iOS). The native work runs to completion and
 * can't be cancelled from JS. Callers that loop should check their
 * signal at the loop boundary before invoking.
 */
export async function getMediaLibraryUri(localId: string | null): Promise<ResolveSourceResult> {
  if (!localId) return deleted
  try {
    const asset = await MediaLibrary.getAssetInfoAsync(localId, {
      shouldDownloadFromNetwork: true,
    })
    if (!asset) {
      logger.debug('mediaLibrary', 'asset_deleted', { localId })
      return deleted
    }
    // The import copier reads bytes off the returned path, so this resolver
    // only ever hands back a file:// uri. localUri is expo's local copy
    // (downloaded or exported); asset.uri is the file:// DATA path on Android
    // but ph:// on iOS. Take the first candidate that is a real file path; a
    // ph:// or a content:// uri is unavailable, not a resolve.
    const uri = fileUri(asset.localUri) ?? fileUri(asset.uri)
    if (uri) return resolved(uri)
    // Asset exists but has neither a localUri nor a readable file:// uri:
    // typically iOS iCloud content that hasn't finished downloading or
    // can't be exported.
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
      // Both fetches threw: a transient Photos-DB error, not proof of deletion.
      // A truly deleted asset returns null (not throw) on the no-download retry.
      return unavailable
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
): Promise<ResolveSourceResult> {
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

function resolveAssetDisplay(asset: MediaLibrary.AssetInfo | null): ResolveSourceResult {
  if (!asset) return deleted
  const uri = normalizeUri(asset.localUri) ?? asset.uri ?? null
  return uri ? resolved(uri) : unavailable
}

/**
 * Resolve a media-library localId to a URI that expo-image can render as a
 * thumbnail, without triggering an iCloud download.
 *
 * iOS: the PHAsset localIdentifier wrapped as a `ph://` URI. expo-image's
 * PhotoKit loader serves a cache-sized tile sized to the view — no full
 * decode, no network. Built synchronously, no native round-trip.
 *
 * Android: MediaStore only exposes a renderable URI via getAssetInfoAsync.
 * The options are ignored on Android (no network occurs), so this is a
 * local MediaStore query returning a `content://` (or `file://`) URI.
 *
 * Returns null when there is no localId or the asset can't be resolved.
 * Display only — these URIs are not readable bytes; use getMediaLibraryUri
 * for hashing/copying/upload.
 */
export async function getOsThumbnailUri(localId: string | null): Promise<string | null> {
  if (!localId) return null
  if (Platform.OS === 'ios') {
    return localId.startsWith('ph://') ? localId : `ph://${localId}`
  }
  try {
    const asset = await MediaLibrary.getAssetInfoAsync(localId, {
      shouldDownloadFromNetwork: false,
    })
    return asset?.uri ?? null
  } catch (e) {
    logger.debug('mediaLibrary', 'os_thumb_uri_failed', { localId, error: e as Error })
    return null
  }
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

/**
 * A normalized file:// path, or null for any other scheme (iOS ph://, a
 * content:// provider uri) or an absent value.
 */
function fileUri(uri: string | null | undefined): string | null {
  const normalized = normalizeUri(uri)
  return normalized?.startsWith('file://') ? normalized : null
}
