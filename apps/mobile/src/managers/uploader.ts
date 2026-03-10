import type { SdkAdapter } from '@siastorage/core/adapters'
import {
  type FileEntry,
  type FlushRecord,
  type UploadDeps,
  UploadManager,
} from '@siastorage/core/services/uploader'
import { logger } from '@siastorage/logger'
import { useCallback } from 'react'
import { AppState } from 'react-native'
import { createFileReader } from '../lib/fileReader'
import { pinnedObjectToLocalObject } from '../lib/localObjects'
import {
  type FileRecordRow,
  getFilesLocalOnly,
  readFileRecord,
} from '../stores/files'
import { getFsFileUri } from '../stores/fs'
import { upsertLocalObject } from '../stores/localObjects'
import { getIsConnected, getSdk, useSdk } from '../stores/sdk'
import { getAutoScanUploads, getIndexerURL } from '../stores/settings'
import {
  getActiveUploads,
  registerUpload,
  removeUpload,
  setUploadBatchInfo,
  setUploadError,
  setUploadStatus,
  updateUploadProgress,
} from '../stores/uploads'

export type { FileEntry, FlushRecord }

function buildUploadDeps(sdk: SdkAdapter, indexerURL: string): UploadDeps {
  return {
    sdk,
    files: {
      read: (id) => readFileRecord(id),
      getLocalOnly: (opts) => getFilesLocalOnly(opts),
      getFsFileUri: (file) => getFsFileUri(file),
    },
    localObjects: {
      upsert: (lo) => upsertLocalObject(lo),
    },
    platform: {
      isConnected: () => getIsConnected(),
      autoScanEnabled: () => getAutoScanUploads(),
      getIndexerURL: () => indexerURL,
      createFileReader: (uri) => createFileReader(uri),
      pinnedObjectToLocalObject: (fileId, url, po: any) =>
        pinnedObjectToLocalObject(fileId, url, po),
    },
    uploads: {
      register: (fileId, size) => registerUpload(fileId, size),
      remove: (fileId) => removeUpload(fileId),
      setStatus: (fileId, status) => setUploadStatus(fileId, status),
      setError: (fileId, message) => setUploadError(fileId, message),
      setBatchInfo: (fileId, batchId, count) =>
        setUploadBatchInfo(fileId, batchId, count),
      updateProgress: (fileId, progress) =>
        updateUploadProgress(fileId, progress),
      getActive: () => getActiveUploads(),
    },
  }
}

let uploadManager: UploadManager | null = null
let appStateSubscription: ReturnType<typeof AppState.addEventListener> | null =
  null

/** Returns the singleton UploadManager, creating it on first access. */
export function getUploadManager(): UploadManager {
  if (!uploadManager) {
    uploadManager = new UploadManager()
  }
  return uploadManager
}

/** Connect the UploadManager to the SDK and start processing. */
export async function initializeUploader(sdk: SdkAdapter): Promise<void> {
  if (uploadManager) {
    await uploadManager.shutdown()
  }
  appStateSubscription?.remove()
  const indexerURL = await getIndexerURL()
  const deps = buildUploadDeps(sdk, indexerURL)
  const manager = getUploadManager()
  manager.initialize(deps)
  appStateSubscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      manager.adjustBatchForSuspension()
    }
  })
}

/** React hook: returns a callback that enqueues files for upload. */
export function useUploader() {
  const sdk = useSdk()

  return useCallback(
    async (files: FileRecordRow[]) => {
      if (!sdk) {
        logger.warn('useUploader', 'sdk_not_initialized')
        return
      }

      const entries: FileEntry[] = []
      for (const file of files) {
        const fileUri = await getFsFileUri(file)
        if (!fileUri) {
          logger.warn('useUploader', 'file_not_local', { fileId: file.id })
          continue
        }
        entries.push({ fileId: file.id, fileUri, file, size: file.size })
      }

      if (entries.length > 0) {
        getUploadManager().enqueue(entries)
      }
    },
    [sdk],
  )
}

/** Re-enqueue a single file for upload (e.g. after a previous failure). */
export async function reuploadFile(fileId: string): Promise<void> {
  const sdk = getSdk()
  if (!sdk) throw new Error('SDK not initialized')

  const file = await readFileRecord(fileId)
  if (!file) throw new Error('File not found')

  const fileUri = await getFsFileUri(file)
  if (!fileUri) throw new Error('File not available locally')

  getUploadManager().enqueue([
    { fileId: file.id, fileUri, file, size: file.size },
  ])
}

/** React hook wrapper for reuploadFile. */
export function useReuploadFile() {
  return useCallback(async (fileId: string) => {
    await reuploadFile(fileId)
  }, [])
}

/** Enqueue a file by ID if it exists locally and SDK is available. */
export async function queueUploadForFileId(fileId: string): Promise<void> {
  const sdk = getSdk()
  if (!sdk) return

  const file = await readFileRecord(fileId)
  if (!file) return

  const fileUri = await getFsFileUri(file)
  if (!fileUri) return

  getUploadManager().enqueue([
    { fileId: file.id, fileUri, file, size: file.size },
  ])
}
