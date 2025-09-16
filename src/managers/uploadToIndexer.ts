import { PinnedObject, Sdk } from 'react-native-sia'
import { updateUploadProgress } from '../stores/transfers'
import { updateFilePinnedObject } from '../stores/files'
import { encodeFileMetadata } from '../encoding/fileMetadata'
import { logger } from '../lib/logger'

export async function uploadToIndexer(params: {
  file: {
    id: string
    fileName: string | null
    fileType: string | null
    fileSize: number | null
    encryptionKey: Uint8Array
  }
  sdk: Sdk
  indexerURL: string
  dataShards?: number
  parityShards?: number
  data: ArrayBuffer
  signal?: AbortSignal
}): Promise<void> {
  const {
    sdk,
    indexerURL,
    dataShards = 10,
    parityShards = 30,
    data,
    file,
    signal,
  } = params

  const upload = await sdk.upload(
    file.encryptionKey.slice().buffer,
    encodeFileMetadata({
      name: file.fileName ?? '',
      fileType: file.fileType ?? '',
      size: data.byteLength,
    }),
    {
      maxInflight: 15,
      dataShards,
      parityShards,
      progressCallback: {
        progress: (uploaded, encodedSize) => {
          logger.log(
            '[uploadToIndexer] progress',
            uploaded,
            'encodedSize',
            encodedSize
          )
          const percent = (uploaded * 1000n) / encodedSize
          logger.log('[uploadToIndexer] percent', percent)
          updateUploadProgress(file.id, Number(percent) / 1000)
        },
      },
    }
  )

  const chunkSize = 1 * 1024 * 1024 // 1 MiB
  let offset = 0
  const total = data.byteLength

  while (offset < total) {
    logger.log(`[uploadToIndexer] uploading chunk ${offset} of ${total}...`)
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const end = Math.min(offset + chunkSize, total)
    const chunk = data.slice(offset, end)
    if (signal) {
      await upload.write(chunk, { signal })
    } else {
      await upload.write(chunk)
    }
    logger.log(`[uploadToIndexer] uploaded chunk ${offset} of ${total}`)
    offset = end
  }

  let pinnedObject: PinnedObject
  if (signal) {
    pinnedObject = await upload.finalize({ signal })
  } else {
    pinnedObject = await upload.finalize()
  }
  await updateFilePinnedObject(file.id, indexerURL, pinnedObject)
}
