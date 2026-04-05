import { logger } from '@siastorage/logger'
// oxlint-disable-next-line no-restricted-imports -- type-only import for .writableStream() (async)
import type { File } from 'expo-file-system'
import type { Writer } from 'react-native-sia'
import { getOrCreateTempDownloadFile } from '../stores/tempFs'

function createFileWriter(params: {
  writer: WritableStreamDefaultWriter<Uint8Array>
  totalSize?: number
  onProgress?: (progress: number) => void
}): Writer {
  const { writer, totalSize, onProgress } = params
  let bytesWritten = 0
  let chunks = 0

  return {
    async write(data: ArrayBuffer): Promise<void> {
      const buf = new Uint8Array(data)
      bytesWritten += buf.byteLength
      chunks += 1
      await writer.write(buf)

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
    },
  }
}

export async function streamToCache(params: {
  file: { id: string; type: string }
  totalSize?: number
  download: (writer: Writer) => Promise<void>
  onAfterClose?: (targetFile: File) => Promise<void>
  onProgress?: (progress: number) => void
}): Promise<void> {
  const { file, totalSize, download, onAfterClose, onProgress } = params
  const targetFile = await getOrCreateTempDownloadFile({
    ...file,
    localId: null,
  })
  logger.debug('streamToCache', 'write_start', { uri: targetFile.uri })

  const fileWriter = targetFile.writableStream().getWriter()

  try {
    const writer = createFileWriter({
      writer: fileWriter,
      totalSize,
      onProgress,
    })

    await download(writer)

    logger.debug('streamToCache', 'stream_ended')
  } finally {
    await fileWriter.close()
    logger.debug('streamToCache', 'writer_closed')
  }

  if (onAfterClose) {
    await onAfterClose(targetFile)
  }
}
