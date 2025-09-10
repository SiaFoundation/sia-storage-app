import { Sdk } from 'react-native-sia'
import { updateUploadProgress, setUploadState } from './uploadState'
import {
  type FileRecord,
  updateFileMetadata,
  updateFileStatus,
} from '../db/files'

export type UploadProgress = {
  bytesWritten: number
  totalBytes: number
  percent: number // 0..1
}

export async function uploadToSia(params: {
  sdk: Sdk
  encryptionKey: ArrayBuffer
  dataShards?: number
  parityShards?: number
  data: ArrayBuffer
  // Persisted file record details; the record should already exist in DB.
  file: Pick<FileRecord, 'id'>
  signal?: AbortSignal
  onProgress?: (p: UploadProgress) => void
}): Promise<void> {
  const {
    sdk,
    encryptionKey,
    dataShards = 10,
    parityShards = 30,
    data,
    file,
    signal,
    onProgress,
  } = params

  const upload = await sdk.upload(encryptionKey, dataShards, parityShards)

  const chunkSize = 1 * 1024 * 1024 // 1 MiB
  let offset = 0
  const total = data.byteLength

  // Initialize runtime state.
  setUploadState(file.id, { status: 'uploading', progress: 0 })

  while (offset < total) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const end = Math.min(offset + chunkSize, total)
    const chunk = data.slice(offset, end)
    if (signal) {
      await upload.write(chunk, { signal })
    } else {
      await upload.write(chunk)
    }
    offset = end
    const progress = {
      bytesWritten: offset,
      totalBytes: total,
      percent: offset / total,
    }
    updateUploadProgress(file.id, progress.percent)
    onProgress?.(progress)
  }

  try {
    if (signal) {
      await upload.finalize({ signal })
    } else {
      await upload.finalize()
    }
    // Mark as completed in runtime state and update DB metadata to denote cloud presence.
    setUploadState(file.id, { status: 'done', progress: 1 })
    await updateFileMetadata(file.id, { uploaded: true })
    await updateFileStatus(file.id, 'done')
  } catch (e) {
    setUploadState(file.id, { status: 'error', progress: 0 })
    await updateFileStatus(file.id, 'error')
    throw e
  } finally {
    // Optionally keep runtime entry for UI to read final status; do not clear immediately.
    // clearUploadState(file.id)
  }
}
