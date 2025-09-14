import { PinnedObject, Sdk } from 'react-native-sia'
import { updateUploadProgress, setUploadState } from '../stores/uploadState'
import { updateFilePinnedObject } from '../stores/files'
import { PickerAsset } from './uploadManager'
import { encodeFileMetadata } from '../encoding/fileMetadata'
import { logger } from './logger'

export type UploadProgress = {
  bytesWritten: number
  totalBytes: number
  percent: number // 0..1
}

export async function uploadToSia(params: {
  asset: PickerAsset
  sdk: Sdk
  indexerURL: string
  encryptionKey: Uint8Array
  dataShards?: number
  parityShards?: number
  data: ArrayBuffer
  signal?: AbortSignal
}): Promise<void> {
  const {
    sdk,
    indexerURL,
    encryptionKey,
    dataShards = 10,
    parityShards = 30,
    data,
    asset,
    signal,
  } = params

  const upload = await sdk.upload(
    encryptionKey.slice().buffer,
    encodeFileMetadata({
      name: asset.fileName ?? '',
      fileType: asset.fileType ?? '',
      size: data.byteLength,
    }),
    {
      maxInflight: 15,
      dataShards,
      parityShards,
      progressCallback: {
        progress: (uploaded, encodedSize) => {
          logger.log('uploaded', uploaded, 'encodedSize', encodedSize)
          const percent = (uploaded * 1000n) / encodedSize
          logger.log('percent', percent)
          updateUploadProgress(asset.id, Number(percent) / 1000)
        },
      },
    }
  )

  const chunkSize = 1 * 1024 * 1024 // 1 MiB
  let offset = 0
  const total = data.byteLength

  // Initialize runtime state.
  setUploadState(asset.id, { status: 'uploading', progress: 0 })

  while (offset < total) {
    logger.log(`Uploading chunk ${offset} of ${total}...`)
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const end = Math.min(offset + chunkSize, total)
    const chunk = data.slice(offset, end)
    if (signal) {
      await upload.write(chunk, { signal })
    } else {
      await upload.write(chunk)
    }
    logger.log(`Uploaded chunk ${offset} of ${total}`)
    offset = end
  }

  try {
    let pinnedObject: PinnedObject
    if (signal) {
      pinnedObject = await upload.finalize({ signal })
    } else {
      pinnedObject = await upload.finalize()
    }
    setUploadState(asset.id, { status: 'done', progress: 1 })
    await updateFilePinnedObject(asset.id, indexerURL, pinnedObject)
  } catch (e) {
    setUploadState(asset.id, { status: 'error', progress: 0 })
    throw e
  }
}
