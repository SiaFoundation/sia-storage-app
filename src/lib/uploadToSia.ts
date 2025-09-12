import { PinnedObject, Sdk } from 'react-native-sia'
import { updateUploadProgress, setUploadState } from './uploadState'
import { updateFilePinnedObject } from '../db/files'
import { Logger } from './settingsContext'
import { PickerAsset } from './uploadManager'
import { createFileMetadata } from './file'

export type UploadProgress = {
  bytesWritten: number
  totalBytes: number
  percent: number // 0..1
}

export async function uploadToSia(params: {
  asset: PickerAsset
  log: Logger
  sdk: Sdk
  indexerURL: string
  encryptionKey: ArrayBuffer
  dataShards?: number
  parityShards?: number
  data: ArrayBuffer
  signal?: AbortSignal
}): Promise<void> {
  const {
    log,
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
    encryptionKey,
    dataShards,
    parityShards,
    createFileMetadata({
      name: asset.fileName ?? '',
      fileType: asset.fileType ?? '',
      size: data.byteLength,
    })
  )

  const chunkSize = 1 * 1024 * 1024 // 1 MiB
  let offset = 0
  const total = data.byteLength

  // Initialize runtime state.
  setUploadState(asset.id, { status: 'uploading', progress: 0 })

  while (offset < total) {
    log(`Uploading chunk ${offset} of ${total}...`)
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const end = Math.min(offset + chunkSize, total)
    const chunk = data.slice(offset, end)
    if (signal) {
      await upload.write(chunk, { signal })
    } else {
      await upload.write(chunk)
    }
    log(`Uploaded chunk ${offset} of ${total}`)
    offset = end
    const progress = {
      bytesWritten: offset,
      totalBytes: total,
      percent: offset / total,
    }
    updateUploadProgress(asset.id, progress.percent)
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
