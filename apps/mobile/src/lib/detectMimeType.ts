import {
  detectMimeTypeFromBytes,
  MAGIC_BYTES_LENGTH,
} from '@siastorage/core/lib/detectMimeType'
import { logger } from '@siastorage/logger'
import type { MimeType } from './fileTypes'
import { readFileBytes } from './readFileBytes'

export { detectMimeTypeFromBytes, MAGIC_BYTES_LENGTH }

/**
 * Sniff file type from magic numbers.
 * Reads first 32 bytes from a file URI and checks against known signatures.
 */
export async function detectMimeType(
  uri: string | undefined,
): Promise<MimeType | null> {
  if (!uri) return null

  try {
    const bytes = await readFileBytes(uri, MAGIC_BYTES_LENGTH)
    if (!bytes || bytes.length === 0) {
      return null
    }
    return detectMimeTypeFromBytes(bytes) as MimeType | null
  } catch (e) {
    logger.error('detectMimeType', 'error', { error: e as Error })
    return null
  }
}
