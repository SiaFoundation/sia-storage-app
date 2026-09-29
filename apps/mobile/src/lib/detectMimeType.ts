import {
  detectMimeType as detectFromBytesAndName,
  detectMimeTypeFromBytes,
  MAGIC_BYTES_LENGTH,
} from '@siastorage/core/lib/detectMimeType'
import { logger } from '@siastorage/logger'
import type { MimeType } from './fileTypes'
import { readFileBytes } from './readFileBytes'

export { detectMimeTypeFromBytes, MAGIC_BYTES_LENGTH }

/**
 * Sniff file type from magic numbers.
 * Reads first 32 bytes from a file URI and checks against known signatures,
 * then falls back to the extension of `name` when one is given.
 */
export async function detectMimeType(
  uri: string | undefined,
  name?: string,
): Promise<MimeType | null> {
  if (!uri) return null

  let bytes: Uint8Array | null = null
  try {
    bytes = await readFileBytes(uri, MAGIC_BYTES_LENGTH)
  } catch (e) {
    logger.error('detectMimeType', 'error', { error: e as Error })
  }
  if (name === undefined) {
    return bytes && bytes.length > 0 ? (detectMimeTypeFromBytes(bytes) as MimeType | null) : null
  }
  const type = detectFromBytesAndName({ fileName: name, bytes })
  return type === 'application/octet-stream' ? null : (type as MimeType)
}
