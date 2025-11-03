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

/** Streamed SHA-256. */
async function sha256File(uri: string): Promise<string> {
  const h = QuickCrypto.createHash('sha256')
  const chunkSize = 1 * 1024 * 1024 // 1MB

  try {
    const stat = await RNFS.stat(uri)
    let pos = 0
    while (pos < stat.size) {
      const len = Math.min(chunkSize, stat.size - pos)
      const b64 = await RNFS.read(uri, len, pos, 'base64')
      const buf = Buffer.from(b64, 'base64')
      h.update(sliceBuffer(buf))
      pos += len
    }
  } catch {
    // Fallback for URIs where stat/ranged read is unsupported (some content:// cases):
    // Read entire file. Prefer avoiding this for very large files but ensures correctness.
    const b64 = await RNFS.readFile(uri, 'base64')
    const buf = Buffer.from(b64, 'base64')
    h.update(sliceBuffer(buf))
  }
  return h.digest('hex')
}

// Extract the exact ArrayBuffer slice to avoid extra capacity bytes.
function sliceBuffer(buf: Buffer<ArrayBuffer>): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}
