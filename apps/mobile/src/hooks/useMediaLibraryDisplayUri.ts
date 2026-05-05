import type { FileRecord } from '@siastorage/core/types'
import * as MediaLibrary from 'expo-media-library'
import useSWR from 'swr'
import { getMediaLibraryUri } from '../lib/mediaLibrary'

/**
 * Resolve a media library asset to a displayable URI.
 *
 * First tries getMediaLibraryUri which returns a file:// path via localUri.
 * On Android, localUri is only populated for images (expo-media-library
 * limitation), so videos and other media return status 'unavailable'. In
 * that case we fall back to the asset's own URI (also file://) which
 * media players can load directly.
 *
 * Returns { uri, isLoading } — uri is null when the asset is deleted
 * or hasn't resolved yet.
 */
export function useMediaLibraryDisplayUri(file: FileRecord) {
  // Resolve localId for files still importing (hash empty) or files
  // whose upload failed (no sealed objects on the network).
  const hasNoSealedObjects = Object.keys(file.objects).length === 0
  const localId = (file.hash === '' || hasNoSealedObjects) && file.localId ? file.localId : null

  const mediaLibrarySwr = useSWR(localId ? ['mediaLibraryUri', localId] : null, () =>
    getMediaLibraryUri(localId),
  )

  const fileUri = mediaLibrarySwr.data?.status === 'resolved' ? mediaLibrarySwr.data.uri : null

  // Only attempt the asset URI fallback when the asset exists but its
  // localUri isn't available (status 'unavailable'). Skip when the asset
  // is deleted — there's nothing to fall back to.
  //
  // getMediaLibraryUri (above) returns asset.localUri, which on Android is
  // only set for images. This fallback grabs asset.uri instead — a separate
  // property that's available for all media types including video.
  const needsFallback = mediaLibrarySwr.data?.status === 'unavailable'
  const assetUriSwr = useSWR(
    needsFallback && localId ? ['mediaLibraryAssetUri', localId] : null,
    async () => {
      const asset = await MediaLibrary.getAssetInfoAsync(localId!, {
        shouldDownloadFromNetwork: false,
      })
      return asset?.uri ?? null
    },
  )

  const uri = fileUri || assetUriSwr.data || null
  const isLoading = localId
    ? (!mediaLibrarySwr.data && !mediaLibrarySwr.error) ||
      (needsFallback && !assetUriSwr.data && !assetUriSwr.error)
    : false

  return { uri, isLoading, hasNoSealedObjects }
}
