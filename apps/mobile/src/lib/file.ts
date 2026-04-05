import type { DownloadEntry } from '@siastorage/core/app'
import type { LocalObject } from '@siastorage/core/encoding/localObject'
import { useDownloadEntry } from '@siastorage/core/stores'
import type { FileRecord } from '@siastorage/core/types'
import { useMemo } from 'react'
import { PinnedObject, type PinnedObjectInterface, type SealedObject } from 'react-native-sia'
import { getAppKeyForIndexer } from '../stores/appKey'
import { app } from '../stores/appService'
import { useFsFileUri } from '../stores/fs'
import { type UploadState, useUploadState } from '../stores/uploads'

export function fileHasASealedObject(file?: FileRecord): boolean {
  return !!Object.keys(file?.objects ?? {}).length
}

export type FileItemProps = {
  file: FileRecord
  onPressItem: (item: FileRecord) => void
  onLongPressItem?: (item: FileRecord) => void
}

export function fileRecordEqual(a: FileRecord, b: FileRecord): boolean {
  return (
    a.id === b.id &&
    a.updatedAt === b.updatedAt &&
    a.hash === b.hash &&
    // Re-render when sealed objects change (e.g., upload completes) since
    // updatedAt doesn't change when a local object is added.
    Object.keys(a.objects).length === Object.keys(b.objects).length
  )
}

export function fileItemPropsAreEqual(prev: FileItemProps, next: FileItemProps): boolean {
  return (
    fileRecordEqual(prev.file, next.file) &&
    prev.onPressItem === next.onPressItem &&
    prev.onLongPressItem === next.onLongPressItem
  )
}

export type FileStatus = {
  isProcessing: boolean
  isDeferredImport: boolean
  isImportFailed: boolean
  isUploading: boolean
  isDownloading: boolean
  isUploaded: boolean
  isDownloaded: boolean
  isErrored: boolean
  uploadProgress: number
  downloadProgress: number
  isUploadQueued: boolean
  isDownloadQueued: boolean
  isPacking: boolean
  batchFileCount: number
  fileUri: string | null
  fileIsGone: boolean
  errorText: string | null
}

export function computeFileStatus({
  file,
  isShared,
  uploadState,
  downloadState,
  fileUri,
  errorText,
}: {
  file?: FileRecord
  isShared?: boolean
  uploadState: UploadState | undefined
  downloadState: DownloadEntry | undefined
  fileUri: string | null
  errorText: string | null
}) {
  const isProcessing = !!file && file.hash === ''
  // Deferred import: placeholder created by archive sync with localId,
  // waiting for the scanner to copy from the media library.
  const isDeferredImport = isProcessing && !fileUri && !!file?.localId
  const isImportFailed = !!file?.lostReason
  const uploadStatus = uploadState?.status
  const isUploading = ['queued', 'packing', 'packed', 'uploading'].includes(uploadStatus ?? '')
  const isPacking = uploadStatus === 'packing' || uploadStatus === 'packed'
  const isDownloading =
    downloadState?.status === 'downloading' || downloadState?.status === 'queued'
  const hasSealedObject = fileHasASealedObject(file)
  const isDownloaded = !!fileUri
  return {
    isProcessing,
    isDeferredImport,
    isImportFailed,
    isUploading,
    isDownloading,
    isUploadQueued: uploadStatus === 'queued',
    isDownloadQueued: downloadState?.status === 'queued',
    isPacking,
    batchFileCount: uploadState?.batchFileCount ?? 0,
    isUploaded: hasSealedObject || !!isShared,
    isDownloaded,
    isErrored: isImportFailed || uploadStatus === 'error' || downloadState?.status === 'error',
    uploadProgress: uploadState?.progress ?? 0,
    downloadProgress: downloadState?.progress ?? 0,
    fileUri,
    fileIsGone:
      !!file?.lostReason ||
      (!isProcessing && !isUploading && !isDownloading && !hasSealedObject && !fileUri),
    errorText: isImportFailed ? 'Import failed' : errorText,
  }
}

export type FileStatusResponse = {
  data: FileStatus | undefined
  isLoading: boolean
}

export function useFileStatus(file?: FileRecord, isShared?: boolean): FileStatusResponse {
  const uploadState = useUploadState(file?.id || '')
  const { data: downloadState } = useDownloadEntry(file?.id || '')
  const fileUri = useFsFileUri(file)

  const data = useMemo(() => {
    if (fileUri.isLoading) return undefined
    return computeFileStatus({
      file,
      isShared,
      uploadState,
      downloadState,
      fileUri: fileUri.data ?? null,
      errorText: uploadState?.error || downloadState?.error || null,
    })
  }, [file, isShared, uploadState, downloadState, fileUri.data, fileUri.isLoading])

  return { data, isLoading: fileUri.isLoading }
}

export type BulkCounts = {
  onNetwork: number
  downloadable: number
  uploadable: number
  total: number
  files: FileRecord[]
}

export async function fetchBulkCounts(fileIds: string[]): Promise<BulkCounts> {
  const files: FileRecord[] = []
  let onNetwork = 0
  let downloadable = 0
  let uploadable = 0

  for (const id of fileIds) {
    const file = await app().files.getById(id)
    if (file) {
      files.push(file)
      const hasSealed = fileHasASealedObject(file)
      const uri = await app().fs.getFileUri(file)
      if (hasSealed) {
        onNetwork++
      }
      if (hasSealed && !uri) {
        downloadable++
      }
      if (uri && !hasSealed) {
        uploadable++
      }
    }
  }

  return { onNetwork, downloadable, uploadable, total: files.length, files }
}

export function getFileTypeName(
  file: FileRecord,
): 'photo' | 'video' | 'audio' | 'document' | 'other' {
  return file.type?.startsWith('image')
    ? 'photo'
    : file.type?.startsWith('video')
      ? 'video'
      : file.type?.startsWith('audio')
        ? 'audio'
        : file.type?.startsWith('application')
          ? 'document'
          : 'other'
}

export function getOneSealedObject(file: {
  objects: Record<string, LocalObject> | null
}): { indexerURL: string; sealedObject: SealedObject } | null {
  const entries = Object.entries(file.objects ?? {})
  if (entries.length === 0) return null
  const [indexerURL, sealedObject] = entries[0]
  return { indexerURL, sealedObject }
}

export async function getPinnedObject(
  indexerURL: string,
  sealedObject: SealedObject,
): Promise<PinnedObjectInterface> {
  const appKey = await getAppKeyForIndexer(indexerURL)
  if (!appKey) {
    throw new Error(`No AppKey found for indexer: ${indexerURL}`)
  }
  return PinnedObject.open(appKey, sealedObject)
}
