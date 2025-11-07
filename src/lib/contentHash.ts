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

/** SHA-256. Try streamed native RNFS.hash first, otherwise fallback to QuickCrypto. */
async function sha256File(uri: string): Promise<string> {
  try {
    return await rnfsHash(uri)
  } catch {
    return await quickcryptoHash(uri)
  }
}

export async function rnfsHash(uri: string): Promise<string> {
  return RNFS.hash(uri, 'sha256')
}

export async function quickcryptoHash(uri: string): Promise<string> {
  const b64 = await RNFS.readFile(uri, 'base64')
  const h = QuickCrypto.createHash('sha256')
  h.update(sliceBuffer(Buffer.from(b64, 'base64')))
  return h.digest('hex')
}

// Extract the exact ArrayBuffer slice to avoid extra capacity bytes.
function sliceBuffer(buf: Buffer<ArrayBuffer>): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}
