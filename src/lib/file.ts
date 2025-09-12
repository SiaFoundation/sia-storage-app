import { useMemo } from 'react'
import { FileRecord } from '../db/files'
import { getDownloadState, useDownloadState } from './downloadState'
import { getUploadState, useUploadState } from './uploadState'
import { readCachedUri, useCachedUri } from './fileCache'
import { extFromMime } from './fileTypes'
import { PinnedObject, Slab } from 'react-native-sia'

export function isFileOnSiaNetwork(file: { pinnedObjects: unknown }): boolean {
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

export async function getFileStatus(file: {
  id: string
  fileType: string
  pinnedObjects: unknown
}): Promise<FileStatus> {
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
export function useFileStatus(file: {
  id: string
  fileType: string | null
  pinnedObjects: unknown
}): FileStatus {
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
