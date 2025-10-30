import { useEffect } from 'react'
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
import { LocalObject } from '../encoding/localObject'
import { getAppKey } from './appKey'
import { SWRResponse } from 'swr'
import useSWR from 'swr'

export function fileHasASealedObject(file?: FileRecord): boolean {
  return !!Object.keys(file?.objects ?? {}).length
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
  isShared,
  uploadState,
  downloadState,
  fileUri,
  errorText,
}: {
  file?: FileRecord
  isShared?: boolean
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
    isUploaded: hasSealedObject || !!isShared,
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

export function useFileStatus(
  file?: FileRecord,
  isShared?: boolean
): SWRResponse<FileStatus, Error> {
  const uploadState = useUploadState(file?.id || '')
  const downloadState = useDownloadState(file?.id || '')
  const fileUri = useFileUri(file)
  const response = useSWR(fileUri.isLoading ? null : [file?.id, 'status'], () =>
    computeFileStatus({
      file,
      isShared,
      uploadState,
      downloadState,
      fileUri: fileUri.data ?? null,
      errorText: uploadState?.error || downloadState?.error || null,
    })
  )
  // Immediately update when there are changes to data or transfer progress.
  useEffect(() => {
    response.mutate()
  }, [file, uploadState, downloadState, fileUri.data])
  return response
}

export function getFileTypeName(
  file: FileRecord
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
}): SealedObject | null {
  const objects = Object.values(file.objects ?? {})
  return objects[0] ?? null
}

export async function getPinnedObject(
  sealedObject: SealedObject
): Promise<PinnedObjectInterface> {
  return PinnedObject.open(await getAppKey(), sealedObject)
}
