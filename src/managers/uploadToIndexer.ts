import { Sdk } from 'react-native-sia'
import { updateUploadProgress } from '../stores/transfers'
import { updateFileSealedObject } from '../stores/files'
import { encodeFileMetadata } from '../encoding/fileMetadata'
import { logger } from '../lib/logger'
import {
  UPLOAD_MAX_INFLIGHT,
  UPLOAD_DATA_SHARDS,
  UPLOAD_PARITY_SHARDS,
  UPLOAD_CHUNK_SIZE,
} from '../config'
import { getAppKey } from '../lib/appKey'

export async function uploadToIndexer(params: {
  file: {
    id: string
    fileName: string | null
    fileType: string | null
    fileSize: number | null
  }
  sdk: Sdk
  indexerURL: string
  data: ArrayBuffer
  signal?: AbortSignal
}): Promise<void> {
  const { sdk, indexerURL, data, file, signal } = params

  const upload = await sdk.upload({
    maxInflight: UPLOAD_MAX_INFLIGHT,
    dataShards: UPLOAD_DATA_SHARDS,
    parityShards: UPLOAD_PARITY_SHARDS,
    metadata: encodeFileMetadata({
      name: file.fileName ?? '',
      fileType: file.fileType ?? '',
      size: data.byteLength,
    }),
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
  })

  let offset = 0
  const total = data.byteLength

  while (offset < total) {
    logger.log(`[uploadToIndexer] uploading chunk ${offset} of ${total}...`)
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const end = Math.min(offset + UPLOAD_CHUNK_SIZE, total)
    const chunk = data.slice(offset, end)
    if (signal) {
      await upload.write(chunk, { signal })
    } else {
      await upload.write(chunk)
    }
    logger.log(`[uploadToIndexer] uploaded chunk ${offset} of ${total}`)
    offset = end
  }

  logger.log('[uploadToIndexer] finalizing upload...')
  const pinnedObject = await upload.finalize(signal ? { signal } : undefined)
  logger.log('[uploadToIndexer] sealing object...')
  const appKey = await getAppKey()
  const sealedObject = pinnedObject.seal(appKey)
  logger.log('[uploadToIndexer] updating file sealed object...')
  await updateFileSealedObject(file.id, indexerURL, sealedObject)
}
