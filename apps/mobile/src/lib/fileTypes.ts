export {
  type Ext,
  extFromMime,
  getMimeTypeFromExtension,
  isMimeType,
  type MimeType,
  MimeTypes,
} from '@siastorage/core/lib/fileTypes'

import {
  detectMimeType as detectMimeTypeSync,
  MAGIC_BYTES_LENGTH,
} from '@siastorage/core/lib/detectMimeType'
import type { MimeType } from '@siastorage/core/lib/fileTypes'
import { readFileBytes } from './readFileBytes'

/**
 * Detect the mimeType from available fields.
 * Async wrapper that reads bytes from URI then calls core's detectMimeType.
 */
export async function getMimeType(asset: {
  type?: string
  name?: string
  uri?: string
}): Promise<MimeType> {
  let bytes: Uint8Array | null = null
  if (asset.uri) {
    try {
      bytes = await readFileBytes(asset.uri, MAGIC_BYTES_LENGTH)
    } catch {
      // If we can't read bytes, fall through to other detection methods
    }
  }
  return detectMimeTypeSync({
    providedType: asset.type,
    fileName: asset.name ?? asset.uri,
    bytes,
  }) as MimeType
}
