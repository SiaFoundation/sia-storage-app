import * as MediaLibrary from 'expo-media-library'

/**
 * Get the local URI for a file record. If the file has a local ID, use the
 * local URI from the MediaLibrary. The media may need to be downloaded from
 * the network if it is not already cached.
 */
export async function getMediaLibraryUri(
  localId: string | null,
): Promise<string | null> {
  if (!localId) return null
  try {
    const asset = await MediaLibrary.getAssetInfoAsync(localId, {
      shouldDownloadFromNetwork: true,
    })
    return normalizeUri(asset.localUri)
  } catch (_e) {
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
