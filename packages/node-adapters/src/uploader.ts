import type { Reader } from '@siastorage/core/adapters'
import type { UploaderAdapters } from '@siastorage/core/services/uploader'
import { open, type FileHandle } from 'fs/promises'

const CHUNK_SIZE = 64 * 1024

export function createNodeUploaderAdapters(): UploaderAdapters {
  return {
    createFileReader(uri: string): Reader {
      const filePath = uri.replace(/^file:\/\//, '')
      let handle: FileHandle | null = null
      let offset = 0
      let done = false

      return {
        async read(): Promise<ArrayBuffer> {
          if (done) return new ArrayBuffer(0)
          if (!handle) handle = await open(filePath, 'r')

          // Copy into a standalone Buffer — Bun's Buffer.subarray() shares
          // an internal memory pool that NAPI bindings can't read from.
          const chunk = Buffer.allocUnsafe(CHUNK_SIZE)
          const { bytesRead } = await handle.read(chunk, 0, CHUNK_SIZE, offset)
          if (bytesRead === 0) {
            done = true
            await handle.close()
            handle = null
            return new ArrayBuffer(0)
          }
          offset += bytesRead

          if (bytesRead < CHUNK_SIZE) {
            const final = Buffer.allocUnsafe(bytesRead)
            chunk.copy(final, 0, 0, bytesRead)
            return final.buffer.slice(final.byteOffset, final.byteOffset + final.byteLength)
          }
          return chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)
        },
      }
    },

    progressScheduler(cb: () => void) {
      setImmediate(cb)
    },
  }
}
