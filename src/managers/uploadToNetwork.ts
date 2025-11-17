import { Sdk, encodedSize } from 'react-native-sia'
import { File } from 'expo-file-system'
import { docsCacheGetLocalUri } from '../stores/fs'
import {
  tempFsGetUploadFileForId,
  tempFsRemoveUploadFileForId,
} from '../stores/tempFs'
import { updateUploadProgress } from '../stores/uploads'
import { encodeFileMetadata } from '../encoding/fileMetadata'
import { logger } from '../lib/logger'
import {
  UPLOAD_MAX_INFLIGHT,
  UPLOAD_DATA_SHARDS,
  UPLOAD_PARITY_SHARDS,
} from '../config'
import { upsertLocalObject } from '../stores/localObjects'
import { pinnedObjectToLocalObject } from '../lib/localObjects'
import { FileRecordRow } from '../stores/files'

export async function uploadToNetwork(params: {
  file: FileRecordRow
  fileUri: string
  sdk: Sdk
  indexerURL: string
  signal: AbortSignal
}): Promise<void> {
  const { sdk, indexerURL, fileUri, file, signal } = params
  const fileSize = file.size

  if (signal.aborted) {
    return
  }

  let stream: ReadableStream<Uint8Array<ArrayBuffer>>
  if (file.localId) {
    logger.log(
      '[uploadToNetwork] file is a localId asset, streaming from tmp file...'
    )
    const localUri = await docsCacheGetLocalUri(file.localId)
    if (!localUri) {
      throw new Error('Local URI not found')
    }
    const source = new File(localUri)
    const tmp = await tempFsGetUploadFileForId(file)
    source.copy(tmp)
    stream = tmp.stream()
  } else {
    logger.log('[uploadToNetwork] file is in app cache, streaming directly...')
    stream = new File(fileUri).stream()
  }

  const totalEncodedSize = encodedSize(
    BigInt(fileSize),
    UPLOAD_DATA_SHARDS,
    UPLOAD_PARITY_SHARDS
  )

  const upload = await sdk.upload({
    maxInflight: UPLOAD_MAX_INFLIGHT,
    dataShards: UPLOAD_DATA_SHARDS,
    parityShards: UPLOAD_PARITY_SHARDS,
    metadata: encodeFileMetadata(file),
    progressCallback: {
      progress: (uploaded) => {
        logger.log(
          `[uploadToNetwork] ${file.id} progress`,
          uploaded,
          'totalEncodedSize',
          totalEncodedSize
        )
        const percent = (uploaded * 1000n) / totalEncodedSize
        logger.log(
          `[uploadToNetwork] ${file.id} percent ${percent}, uploaded ${uploaded} bytes`
        )
        updateUploadProgress(file.id, Number(percent) / 1000)
      },
    },
  })

  const onAbort = () => {
    try {
      logger.log('[uploadToNetwork] abort received, cancelling upload...')
      upload.cancel()
    } catch (e) {
      logger.log('[uploadToNetwork] error cancelling upload', e)
    }
  }

  if (signal.aborted) {
    onAbort()
    return
  }

  signal.addEventListener('abort', onAbort)
  const reader = stream.getReader()
  let uploadedBytes = 0
  // Read and upload from the file stream until exhausted or aborted.
  logger.log(
    `[uploadToNetwork] ${file.id} reading and uploading from stream...`
  )
  while (true) {
    if (signal.aborted) break
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      const arrayBuffer = value.buffer.slice(
        value.byteOffset,
        value.byteOffset + value.byteLength
      )
      await upload.write(arrayBuffer, { signal })
      uploadedBytes += value.byteLength
    }
  }
  logger.log(
    `[uploadToNetwork] ${file.id} uploaded ${uploadedBytes}/${fileSize} bytes`
  )
  logger.log(`[uploadToNetwork] ${file.id} finalizing upload...`)
  const pinnedObject = await upload.finalize({ signal })

  if (signal.aborted) {
    signal.removeEventListener('abort', onAbort)
    return
  }

  logger.log(
    `[uploadToNetwork] ${file.id} converting pinned object to local object...`
  )
  const localObject = await pinnedObjectToLocalObject(
    file.id,
    indexerURL,
    pinnedObject
  )
  logger.log(`[uploadToNetwork] ${file.id} updating file object...`)
  await upsertLocalObject(localObject)

  signal.removeEventListener('abort', onAbort)
  if (file.localId) {
    await tempFsRemoveUploadFileForId(file)
  }
}
