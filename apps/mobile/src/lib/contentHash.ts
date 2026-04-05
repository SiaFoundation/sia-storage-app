import { logger } from '@siastorage/logger'
import RNFS from 'react-native-fs'

export type HashResult = `sha256:${string}`

/**
 * Calculate a content hash for a file.
 * - Raw byte SHA-256 for exact file identity.
 */
export async function calculateContentHash(uri: string): Promise<HashResult | null> {
  if (!uri || uri === '') {
    return null
  }
  try {
    const hex = await RNFS.hash(uri, 'sha256')
    return `sha256:${hex}`
  } catch (err) {
    logger.error('contentHash', 'sha256_failed', {
      uri,
      error: err as Error,
    })
    return null
  }
}
