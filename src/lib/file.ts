import { useMemo } from 'react'
import { FileRecord } from '../db/files'
import {
  DownloadState,
  getDownloadState,
  useDownloadState,
} from '../stores/downloadState'
import {
  getUploadState,
  UploadState,
  useUploadState,
} from '../stores/uploadState'
import { readCachedUri, useCachedUri } from './fileCache'
import { extFromMime } from './fileTypes'
import { PinnedObject } from 'react-native-sia'

export function fileHasAPinnnedObject(file: {
  pinnedObjects: unknown
}): boolean {
  return !!Object.keys(file.pinnedObjects ?? {}).length
}

export type FileStatus = {
  isUploading: boolean
  isDownloading: boolean
  isUploaded: boolean
  isDownloaded: boolean
  isErrored: boolean
  uploadProgress: number
  downloadProgress: number
  cachedUri: string | null
  fileIsGone: boolean
}

function computeFileStatus({
  file,
  uploadState,
  downloadState,
  cachedUri,
}: {
  file: {
    pinnedObjects: unknown | null
  }
  uploadState: UploadState | undefined
  downloadState: DownloadState | undefined
  cachedUri: string | null
}) {
  const isUploading = uploadState?.status === 'uploading'
  const isDownloading = downloadState?.status === 'downloading'
  const hasPinnedObject = fileHasAPinnnedObject(file)
  return {
    isUploading,
    isDownloading,
    isUploaded: hasPinnedObject,
    isDownloaded: !!cachedUri,
    isErrored:
      uploadState?.status === 'error' || downloadState?.status === 'error',
    uploadProgress: uploadState?.progress ?? 0,
    downloadProgress: downloadState?.progress ?? 0,
    cachedUri,
    fileIsGone:
      !isUploading && !isDownloading && !hasPinnedObject && !cachedUri,
  }
}

export function useFileStatus(file?: {
  id: string
  fileType: string | null
  pinnedObjects: unknown | null
}): FileStatus {
  const uploadState = useUploadState(file?.id || '')
  const downloadState = useDownloadState(file?.id || '')
  const cachedUri = useCachedUri(
    file?.id || '',
    file?.fileType ? extFromMime(file.fileType) : '.bin'
  )
  return useMemo(
    () =>
      computeFileStatus({
        file: file ?? { pinnedObjects: null },
        uploadState,
        downloadState,
        cachedUri: cachedUri.data ?? null,
      }),
    [uploadState, downloadState, cachedUri, file]
  )
}

export function getFileTypeName(
  file: FileRecord
): 'photo' | 'video' | 'audio' | 'document' | 'other' {
  return file.fileType?.startsWith('image')
    ? 'photo'
    : file.fileType?.startsWith('video')
    ? 'video'
    : file.fileType?.startsWith('audio')
    ? 'audio'
    : file.fileType?.startsWith('application')
    ? 'document'
    : 'other'
}

export function getOnePinnedObject(file: {
  pinnedObjects: Record<string, PinnedObject> | null
}): PinnedObject | null {
  const pinnedObjects = Object.values(file.pinnedObjects ?? {})
  return pinnedObjects[0] ?? null
}

export function parseFileMetadata(metadata?: ArrayBuffer): {
  size?: number
  fileType?: string
} {
  if (!metadata) {
    return {}
  }
  return JSON.parse(new TextDecoder().decode(metadata)) as {
    size?: number
    fileType?: string
  }
}

export function createFileMetadata(params: {
  name: string
  fileType: string
  size: number
}): ArrayBuffer {
  return new TextEncoder().encode(
    JSON.stringify({
      name: params.name,
      fileType: params.fileType,
      size: params.size,
    })
  ).buffer as ArrayBuffer
}
