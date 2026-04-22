import type { DownloadLikeRef } from '@siastorage/core/adapters'
import { logger } from '@siastorage/logger'
// oxlint-disable-next-line no-restricted-imports -- type-only import for .writableStream() (async)
import type { File } from 'expo-file-system'
import { getOrCreateTempDownloadFile } from '../stores/tempFs'

/**
 * Streams a pull-based download handle into a temp cache file. Reads
 * chunks from `dl.read()` and writes each to the target file's
 * writableStream until EOF.
 */
export async function streamToCache(params: {
  file: { id: string; type: string }
  totalSize?: number
  dl: DownloadLikeRef
  signal?: AbortSignal
  onAfterClose?: (targetFile: File) => Promise<void>
  onProgress?: (progress: number) => void
}): Promise<void> {
  const { file, totalSize, dl, signal, onAfterClose, onProgress } = params
  const targetFile = await getOrCreateTempDownloadFile({
    ...file,
    localId: null,
  })
  logger.debug('streamToCache', 'write_start', { uri: targetFile.uri })

  const fileWriter = targetFile.writableStream().getWriter()
  let bytesWritten = 0
  let chunks = 0

  try {
    while (true) {
      const chunk = await dl.read(signal ? { signal } : undefined)
      if (chunk.byteLength === 0) break
      const buf = new Uint8Array(chunk)
      await fileWriter.write(buf)
      bytesWritten += buf.byteLength
      chunks += 1

      if (onProgress) {
        if (typeof totalSize === 'number' && totalSize > 0) {
          onProgress(Math.min(1, bytesWritten / totalSize))
        } else if (chunks % 5 === 0) {
          onProgress(Math.min(0.99, (chunks % 20) / 20))
        }
      }

      if (chunks % 10 === 0) {
        logger.debug('streamToCache', 'progress', { bytesWritten })
      }
    }
    logger.debug('streamToCache', 'stream_ended')
  } finally {
    await fileWriter.close()
    logger.debug('streamToCache', 'writer_closed')
    await dl.cancel().catch(() => {})
  }

  if (onAfterClose) {
    await onAfterClose(targetFile)
  }
}
