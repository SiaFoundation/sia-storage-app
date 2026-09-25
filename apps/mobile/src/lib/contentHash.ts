import { logger } from '@siastorage/logger'
import RNFS from 'react-native-fs'
import { type ContentHash, toContentHash } from '@siastorage/core/lib/contentHash'

/**
 * Calculate a content hash for a file.
 * - Raw byte SHA-256 for exact file identity.
 *
 * Suspension signal policy: does NOT accept a signal. Wraps a single
 * native RNFS.hash call that runs to completion on a native thread and
 * can't be cancelled from JS. On iOS suspension the native thread
 * freezes with the process and thaws on resume. Callers that loop over
 * many files should check their signal at the loop boundary.
 */
export async function calculateContentHash(uri: string): Promise<ContentHash | null> {
  if (!uri || uri === '') {
    return null
  }
  try {
    return toContentHash(await RNFS.hash(uri, 'sha256'))
  } catch (err) {
    logger.error('contentHash', 'sha256_failed', {
      uri,
      error: err as Error,
    })
    return null
  }
}
