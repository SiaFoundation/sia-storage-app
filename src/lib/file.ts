import { useMemo } from 'react'
import {
  useTransfersStore,
  makeTransferKey,
  TransferState,
} from '../stores/transfers'
import { useShallow } from 'zustand/react/shallow'
import { FileRecord } from '../stores/files'
import { useDownloadState, useUploadState } from '../stores/transfers'
import { useCachedUri } from '../stores/fileCache'
import { extFromMime } from './fileTypes'
import {
  PinnedObject,
  PinnedObjectInterface,
  SealedObject,
} from 'react-native-sia'
import { SealedObjectsMap } from '../encoding/sealedObjects'
import { getAppKey } from './appKey'

export function fileHasASealedObject(file: {
  sealedObjects?: SealedObjectsMap | null
}): boolean {
  return !!Object.keys(file.sealedObjects ?? {}).length
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
    sealedObjects?: SealedObjectsMap | null
  }
  uploadState: TransferState | undefined
  downloadState: TransferState | undefined
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
  sealedObjects?: SealedObjectsMap | null
}): FileStatus {
  const uploadState = useUploadState(file?.id || '')
  const downloadState = useDownloadState(file?.id || '')
  const cachedUri = useCachedUri(file?.id || '', extFromMime(file?.fileType))
  const [uploadError, downloadError] = useTransfersStore(
    useShallow((state) => {
      const id = file?.id || ''
      const u = id ? state.transfers[makeTransferKey('upload', id)] : undefined
      const d = id
        ? state.transfers[makeTransferKey('download', id)]
        : undefined
      return [u?.error ?? null, d?.error ?? null] as const
    })
  )
  return useMemo(
    () =>
      computeFileStatus({
        file: file ?? { sealedObjects: null },
        uploadState,
        downloadState,
        cachedUri: cachedUri.data ?? null,
        errorText:
          (uploadError as string | null) ||
          (downloadError as string | null) ||
          null,
      }),
    [uploadState, downloadState, cachedUri, file, uploadError, downloadError]
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
  sealedObjects: Record<string, SealedObject> | null
}): SealedObject | null {
  const sealedObjects = Object.values(file.sealedObjects ?? {})
  return sealedObjects[0] ?? null
}

export async function getPinnedObject(
  sealedObject: SealedObject
): Promise<PinnedObjectInterface> {
  return PinnedObject.open(await getAppKey(), sealedObject)
}
