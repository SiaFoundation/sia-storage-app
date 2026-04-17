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
 * Normalize the URI for a file. Remove the hash index if it exists.
 * This is necessary because the MediaLibrary.getAssetInfoAsync() sometimes
 * returns a URI with a hash index that is not valid for the File system API.
 */
function normalizeUri(uri: string | null | undefined): string | null {
  if (!uri) return null
  const hashIndex = uri.indexOf('#')
  return hashIndex >= 0 ? uri.slice(0, hashIndex) : uri
}
