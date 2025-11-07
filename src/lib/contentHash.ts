import RNFS from 'react-native-fs'
import QuickCrypto from 'react-native-quick-crypto'
import { Buffer } from 'buffer'

export type HashResult = `sha256|${string}`

/**
 * Calculate a content hash for a file.
 * - Raw byte SHA-256 for exact file identity.
 */
export async function calculateContentHash(
  uri: string
): Promise<HashResult | null> {
  if (!uri || uri === '') {
    return null
  }
  const hex = await sha256File(uri)
  return `sha256|${hex}`
}

/** SHA-256 via RNFS.hash. Falls back to manual hashing when needed */
async function sha256File(uri: string): Promise<string> {
  try {
    return await RNFS.hash(uri, 'sha256')
  } catch {
    // Fallback for URIs where stat/ranged read is unsupported (some content:// cases):
    // Read entire file. Prefer avoiding this for very large files but ensures correctness.
    const b64 = await RNFS.readFile(uri, 'base64')
    const h = QuickCrypto.createHash('sha256')
    h.update(sliceBuffer(Buffer.from(b64, 'base64')))
    return h.digest('hex')
  }
}

// Extract the exact ArrayBuffer slice to avoid extra capacity bytes.
function sliceBuffer(buf: Buffer<ArrayBuffer>): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}
