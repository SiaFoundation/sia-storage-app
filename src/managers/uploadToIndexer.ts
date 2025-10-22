import { Sdk } from 'react-native-sia'
import { updateUploadProgress } from '../stores/uploads'
import { encodeFileMetadata } from '../encoding/fileMetadata'
import { logger } from '../lib/logger'
import {
  UPLOAD_MAX_INFLIGHT,
  UPLOAD_DATA_SHARDS,
  UPLOAD_PARITY_SHARDS,
  UPLOAD_CHUNK_SIZE,
} from '../config'
import { upsertLocalObject } from '../stores/localObjects'
import { pinnedObjectToLocalObject } from '../lib/localObjects'
import { FileRecordRow } from '../stores/files'

export async function uploadToIndexer(params: {
  file: FileRecordRow
  sdk: Sdk
  indexerURL: string
  data: ArrayBuffer
  signal: AbortSignal
}): Promise<void> {
  const { sdk, indexerURL, data, file, signal } = params

  if (signal.aborted) {
    return
  }

  const upload = await sdk.upload({
    maxInflight: UPLOAD_MAX_INFLIGHT,
    dataShards: UPLOAD_DATA_SHARDS,
    parityShards: UPLOAD_PARITY_SHARDS,
    metadata: encodeFileMetadata({
      ...file,
      fileSize: data.byteLength,
    }),
    progressCallback: {
      progress: (uploaded, encodedSize) => {
        logger.log(
          `[uploadToIndexer] ${file.id} progress`,
          uploaded,
          'encodedSize',
          encodedSize
        )
        const percent = (uploaded * 1000n) / encodedSize
        logger.log(`[uploadToIndexer] ${file.id} percent ${percent}`)
        updateUploadProgress(file.id, Number(percent) / 1000)
      },
    },
  })

  const onAbort = () => {
    try {
      logger.log('[uploadToIndexer] abort received, cancelling upload...')
      upload.cancel()
    } catch (e) {
      logger.log('[uploadToIndexer] error cancelling upload', e)
    }
  }

  if (signal.aborted) {
    onAbort()
    return
  }

  signal.addEventListener('abort', onAbort)

  let offset = 0
  const total = data.byteLength

  while (offset < total) {
    logger.log(
      `[uploadToIndexer] ${file.id} uploading chunk ${offset} of ${total}...`
    )
    if (signal.aborted) {
      break
    }
    const end = Math.min(offset + UPLOAD_CHUNK_SIZE, total)
    const chunk = data.slice(offset, end)
    await upload.write(chunk, { signal })
    logger.log(
      `[uploadToIndexer] ${file.id} uploaded chunk ${offset} of ${total}`
    )
    offset = end
  }

  logger.log(`[uploadToIndexer] ${file.id} finalizing upload...`)
  const pinnedObject = await upload.finalize({ signal })

  if (signal.aborted) {
    signal.removeEventListener('abort', onAbort)
    return
  }

  logger.log(
    `[uploadToIndexer] ${file.id} converting pinned object to local object...`
  )
  const localObject = await pinnedObjectToLocalObject(
    file.id,
    indexerURL,
    pinnedObject
  )
  logger.log(`[uploadToIndexer] ${file.id} updating file object...`)
  await upsertLocalObject(localObject)

  signal.removeEventListener('abort', onAbort)
}
