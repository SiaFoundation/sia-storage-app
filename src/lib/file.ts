import { useMemo } from 'react'
import { type UploadState } from '../stores/uploads'
import { type DownloadState } from '../stores/downloads'
import { FileRecord } from '../stores/files'
import { useDownloadState } from '../stores/downloads'
import { useUploadState } from '../stores/uploads'
import { useCachedUri } from '../stores/fileCache'
import { extFromMime } from './fileTypes'
import {
  PinnedObject,
  PinnedObjectInterface,
  SealedObject,
} from 'react-native-sia'
import { LocalObject, LocalObjectsMap } from '../encoding/localObject'
import { getAppKey } from './appKey'

export function fileHasASealedObject(file: {
  objects?: LocalObjectsMap | null
}): boolean {
  return !!Object.keys(file.objects ?? {}).length
}

export type FileStatus = {
  isUploading: boolean
  isDownloading: boolean
  isUploaded: boolean
  isDownloaded: boolean
  isErrored: boolean
  uploadProgress: number
  downloadProgress: number
  isUploadQueued: boolean
  isDownloadQueued: boolean
  cachedUri: string | null
  fileIsGone: boolean
  errorText: string | null
}

function computeFileStatus({
  file,
  uploadState,
  downloadState,
  cachedUri,
  errorText,
}: {
  file: {
    objects?: LocalObjectsMap | null
  }
  uploadState: UploadState | undefined
  downloadState: DownloadState | undefined
  cachedUri: string | null
  errorText: string | null
}) {
  const isUploading =
    uploadState?.status === 'running' || uploadState?.status === 'queued'
  const isDownloading =
    downloadState?.status === 'running' || downloadState?.status === 'queued'
  const hasSealedObject = fileHasASealedObject(file)
  return {
    isUploading,
    isDownloading,
    isUploadQueued: uploadState?.status === 'queued',
    isDownloadQueued: downloadState?.status === 'queued',
    isUploaded: hasSealedObject,
    isDownloaded: !!cachedUri,
    isErrored:
      uploadState?.status === 'error' || downloadState?.status === 'error',
    uploadProgress: uploadState?.progress ?? 0,
    downloadProgress: downloadState?.progress ?? 0,
    cachedUri,
    fileIsGone:
      !isUploading && !isDownloading && !hasSealedObject && !cachedUri,
    errorText,
  }
}

export function useFileStatus(file?: {
  id: string
  fileType: string | null
  objects?: LocalObjectsMap | null
}): FileStatus {
  const uploadState = useUploadState(file?.id || '')
  const downloadState = useDownloadState(file?.id || '')
  const cachedUri = useCachedUri(file?.id || '', extFromMime(file?.fileType))
  return useMemo(
    () =>
      computeFileStatus({
        file: file ?? { objects: null },
        uploadState,
        downloadState,
        cachedUri: cachedUri.data ?? null,
        errorText: uploadState?.error || downloadState?.error || null,
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

export function getOneSealedObject(file: {
  objects: Record<string, LocalObject> | null
}): SealedObject | null {
  const objects = Object.values(file.objects ?? {})
  return objects[0] ?? null
}

export async function getPinnedObject(
  sealedObject: SealedObject
): Promise<PinnedObjectInterface> {
  return PinnedObject.open(await getAppKey(), sealedObject)
}
