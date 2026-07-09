import { logger } from '@siastorage/logger'
// oxlint-disable-next-line no-restricted-imports -- File constructor + .readableStream() (async)
import { File } from 'expo-file-system'

function isFileUri(uri: string): boolean {
  if (uri.startsWith('/') || uri.startsWith('file://')) return true
  const colon = uri.indexOf(':')
  return colon === -1
}

/**
 * Read the first N bytes from a file.
 * Handles variable chunk sizes by reading multiple chunks if needed.
 */
export async function readFileBytes(uri: string, byteCount: number): Promise<Uint8Array | null> {
  if (!isFileUri(uri)) {
    return null
  }
  try {
    const file = new File(uri)
    const readable = file.readableStream()
    const reader = readable.getReader()

    try {
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
    // A miss is recoverable (callers fall back to extension detection); on
    // Android direct media paths expo's File.open EACCESes for every asset,
    // which at error level floods the log with one error per asset during a
    // library scan.
    logger.debug('readFileBytes', 'error', { error: e as Error })
    return null
  }
}
