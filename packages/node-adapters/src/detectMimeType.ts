import { detectMimeType, MAGIC_BYTES_LENGTH } from '@siastorage/core/lib/detectMimeType'
import * as fs from 'fs'
import * as path from 'path'

export function createNodeDetectMimeType(): (
  filePath: string,
  name?: string,
) => Promise<string | null> {
  return async (filePath: string, name?: string): Promise<string | null> => {
    const resolved = filePath.replace(/^file:\/\//, '')
    const fileName = name ?? path.basename(resolved)
    let bytes: Uint8Array | undefined

    try {
      // A staged path is checked before it is adopted, so a link there must
      // not be read through, and a FIFO must not block the daemon on open.
      const { O_RDONLY, O_NOFOLLOW, O_NONBLOCK } = fs.constants
      const fd = fs.openSync(resolved, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
      try {
        const buf = Buffer.alloc(MAGIC_BYTES_LENGTH)
        const bytesRead = fs.readSync(fd, buf, 0, MAGIC_BYTES_LENGTH, 0)
        bytes = new Uint8Array(buf.buffer, buf.byteOffset, bytesRead)
      } finally {
        fs.closeSync(fd)
      }
    } catch {
      // File not readable, fall back to extension only
    }

    const result = detectMimeType({ fileName, bytes })
    return result === 'application/octet-stream' ? null : result
  }
}
