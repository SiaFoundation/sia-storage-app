import { useMemo } from 'react'
import { FileRecord } from '../db/files'
import { getDownloadState, useDownloadState } from './downloadState'
import { getUploadState, useUploadState } from './uploadState'
import { readCachedUri, useCachedUri } from './fileCache'
import { extFromMime } from './fileTypes'

export function isFileOnSiaNetwork(file: FileRecord): boolean {
  return !!file.pinnedObjects
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
}

export async function getFileStatus(file: FileRecord): Promise<FileStatus> {
  const uploadState = getUploadState(file.id)
  const downloadState = getDownloadState(file.id)
  const cachedUri = await readCachedUri(file.id, extFromMime(file.fileType))
  return {
    isUploading: uploadState?.status === 'uploading',
    isDownloading: downloadState?.status === 'downloading',
    isUploaded: isFileOnSiaNetwork(file),
    isDownloaded: !!cachedUri,
    isErrored:
      uploadState?.status === 'error' || downloadState?.status === 'error',
    uploadProgress: uploadState?.progress ?? 0,
    downloadProgress: downloadState?.progress ?? 0,
    cachedUri,
  }
}
export function useFileStatus(file: FileRecord): FileStatus {
  const uploadState = useUploadState(file.id)
  const downloadState = useDownloadState(file.id)
  const cachedUri = useCachedUri(file.id, extFromMime(file.fileType))
  return useMemo(
    () => ({
      isUploading: uploadState?.status === 'uploading',
      isDownloading: downloadState?.status === 'downloading',
      isUploaded: isFileOnSiaNetwork(file),
      isDownloaded: !!cachedUri.data,
      isErrored:
        uploadState?.status === 'error' || downloadState?.status === 'error',
      uploadProgress: uploadState?.progress ?? 0,
      downloadProgress: downloadState?.progress ?? 0,
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
