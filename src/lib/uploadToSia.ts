import { Sdk, type Slab } from 'react-native-sia'
import { updateUploadProgress, setUploadState } from './uploadState'
import { updateFileMetadata, updateFileSlabs } from '../db/files'
import { Logger } from './settingsContext'

export type UploadProgress = {
  bytesWritten: number
  totalBytes: number
  percent: number // 0..1
}

export async function uploadToSia(params: {
  fileId: string
  log: Logger
  sdk: Sdk
  encryptionKey: ArrayBuffer
  dataShards?: number
  parityShards?: number
  data: ArrayBuffer
  signal?: AbortSignal
}): Promise<void> {
  const {
    log,
    sdk,
    encryptionKey,
    dataShards = 10,
    parityShards = 30,
    data,
    fileId,
    signal,
  } = params

  const upload = await sdk.upload(encryptionKey, dataShards, parityShards)

  const chunkSize = 1 * 1024 * 1024 // 1 MiB
  let offset = 0
  const total = data.byteLength

  // Initialize runtime state.
  setUploadState(fileId, { status: 'uploading', progress: 0 })

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
    updateUploadProgress(fileId, progress.percent)
  }

  try {
    let slabs: Slab[]
    if (signal) {
      slabs = await upload.finalize({ signal })
    } else {
      slabs = await upload.finalize()
    }
    setUploadState(fileId, { status: 'done', progress: 1 })
    await updateFileMetadata(fileId, { uploaded: true })
    await updateFileSlabs(fileId, slabs)
  } catch (e) {
    setUploadState(fileId, { status: 'error', progress: 0 })
    throw e
  }
}
