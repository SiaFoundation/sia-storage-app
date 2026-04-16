import { detectMimeType, MAGIC_BYTES_LENGTH } from '@siastorage/core/lib/detectMimeType'
import * as fs from 'fs'
import * as path from 'path'

export function createNodeDetectMimeType(): (filePath: string) => Promise<string | null> {
  return async (filePath: string): Promise<string | null> => {
    const resolved = filePath.replace(/^file:\/\//, '')
    const fileName = path.basename(resolved)
    let bytes: Uint8Array | undefined

    try {
      const fd = fs.openSync(resolved, 'r')
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
