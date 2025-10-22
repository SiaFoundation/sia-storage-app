import { useMemo } from 'react'
import { type UploadState } from '../stores/uploads'
import { type DownloadState } from '../stores/downloads'
import { FileRecord } from '../stores/files'
import { useDownloadState } from '../stores/downloads'
import { useUploadState } from '../stores/uploads'
import { useFileUri } from '../stores/fileCache'
import {
  PinnedObject,
  PinnedObjectInterface,
  SealedObject,
} from 'react-native-sia'
import { LocalObject, LocalObjectsMap } from '../encoding/localObject'
import { getAppKey } from './appKey'
import { SWRResponse } from 'swr'
import useSWR from 'swr'

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
  fileUri: string | null
  fileIsGone: boolean
  errorText: string | null
}

function computeFileStatus({
  file,
  uploadState,
  downloadState,
  fileUri,
  errorText,
}: {
  file: {
    objects?: LocalObjectsMap | null
  }
  uploadState: UploadState | undefined
  downloadState: DownloadState | undefined
  fileUri: string | null
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
    isDownloaded: !!fileUri,
    isErrored:
      uploadState?.status === 'error' || downloadState?.status === 'error',
    uploadProgress: uploadState?.progress ?? 0,
    downloadProgress: downloadState?.progress ?? 0,
    fileUri,
    fileIsGone: !isUploading && !isDownloading && !hasSealedObject && !fileUri,
    errorText,
  }
}

export function useFileStatus(file?: {
  id: string
  fileType: string | null
  localId?: string | null
  objects?: LocalObjectsMap | null
}): SWRResponse<FileStatus, Error> {
  const uploadState = useUploadState(file?.id || '')
  const downloadState = useDownloadState(file?.id || '')
  const fileUri = useFileUri(file)
  return useSWR(
    [file?.id, 'status'],
    () =>
      computeFileStatus({
        file: file ?? { objects: null },
        uploadState,
        downloadState,
        fileUri: fileUri.data ?? null,
        errorText: uploadState?.error || downloadState?.error || null,
      }),
    {
      refreshInterval: 5_000,
    }
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
