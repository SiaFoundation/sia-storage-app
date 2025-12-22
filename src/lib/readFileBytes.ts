import { File } from 'expo-file-system'
import { logger } from './logger'

/**
 * Read the first N bytes from a file.
 * Handles variable chunk sizes by reading multiple chunks if needed.
 */
export async function readFileBytes(
  uri: string,
  byteCount: number
): Promise<Uint8Array | null> {
  try {
    const file = new File(uri)
    const readable = file.readableStream()
    const reader = readable.getReader()

    try {
      // Read chunks until we have enough bytes (or file ends).
      const chunks: Uint8Array[] = []
      let totalBytes = 0

      while (totalBytes < byteCount) {
        const { value, done } = await reader.read()
        if (done || !value) break

        const chunk = new Uint8Array(value)
        chunks.push(chunk)
        totalBytes += chunk.length
      }

      if (totalBytes === 0) {
        return null
      }

      // Combine chunks and take only the requested number of bytes.
      const bytes = new Uint8Array(Math.min(totalBytes, byteCount))
      let offset = 0
      for (const chunk of chunks) {
        const toCopy = Math.min(chunk.length, byteCount - offset)
        bytes.set(chunk.slice(0, toCopy), offset)
        offset += toCopy
        if (offset >= byteCount) break
      }

      return bytes
    } finally {
      reader.releaseLock()
    }
  } catch (e) {
    logger.error('readFileBytes', 'error:', e)
    return null
  }
}
