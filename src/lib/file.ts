import { useEffect } from 'react'
import {
  PinnedObject,
  type PinnedObjectInterface,
  type SealedObject,
} from 'react-native-sia'
import useSWR, { type SWRResponse } from 'swr'
import type { LocalObject } from '../encoding/localObject'
import { getAppKeyForIndexer } from '../stores/appKey'
import { type DownloadState, useDownloadState } from '../stores/downloads'
import type { FileRecord } from '../stores/files'
import { useFsFileUri } from '../stores/fs'
import { librarySwr } from '../stores/library'
import { readLocalObjectsForFile } from '../stores/localObjects'
import { type UploadState, useUploadState } from '../stores/uploads'

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
  isPacking: boolean
  batchFileCount: number
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
  const uploadStatus = uploadState?.status
  const isUploading = ['queued', 'packing', 'packed', 'uploading'].includes(
    uploadStatus ?? '',
  )
  const isPacking = uploadStatus === 'packing' || uploadStatus === 'packed'
  const isDownloading =
    downloadState?.status === 'running' || downloadState?.status === 'queued'
  const hasSealedObject = fileHasASealedObject(file)
  return {
    isUploading,
    isDownloading,
    isUploadQueued: uploadStatus === 'queued',
    isDownloadQueued: downloadState?.status === 'queued',
    isPacking,
    batchFileCount: uploadState?.batchFileCount ?? 0,
    isUploaded: hasSealedObject || !!isShared,
    isDownloaded: !!fileUri,
    isErrored: uploadStatus === 'error' || downloadState?.status === 'error',
    uploadProgress: uploadState?.progress ?? 0,
    downloadProgress: downloadState?.progress ?? 0,
    fileUri,
    fileIsGone: !isUploading && !isDownloading && !hasSealedObject && !fileUri,
    errorText,
  }
}

export function useFileStatus(
  file?: FileRecord,
  isShared?: boolean,
): SWRResponse<FileStatus, Error> {
  const uploadState = useUploadState(file?.id || '')
  const downloadState = useDownloadState(file?.id || '')
  const fileUri = useFsFileUri(file)

  // Query objects directly from DB to ensure we have fresh data after uploads.
  // This avoids the timing issue where file.objects from props may be stale.
  const objectsSwr = useSWR(
    file?.id ? librarySwr.getKey(`objects/${file.id}`) : null,
    async () => {
      if (!file?.id) return {}
      const objects = await readLocalObjectsForFile(file.id)
      const map: Record<string, LocalObject> = {}
      for (const obj of objects) {
        map[obj.indexerURL] = obj
      }
      return map
    },
  )

  const response = useSWR(
    fileUri.isLoading || objectsSwr.isLoading
      ? null
      : [file?.id, 'status', objectsSwr.data],
    () =>
      computeFileStatus({
        file: file
          ? { ...file, objects: objectsSwr.data ?? file.objects }
          : undefined,
        isShared,
        uploadState,
        downloadState,
        fileUri: fileUri.data ?? null,
        errorText: uploadState?.error || downloadState?.error || null,
      }),
  )

  // Immediately update when there are changes to data or transfer progress.
  // biome-ignore lint/correctness/useExhaustiveDependencies: we want to update when the upload or download state changes
  useEffect(() => {
    response.mutate()
  }, [uploadState, downloadState])

  // Refetch objects when library changes (e.g., after upload completes).
  useEffect(() => {
    const callback = () => objectsSwr.mutate()
    librarySwr.addChangeCallback(`fileStatus/${file?.id}`, callback)
    return () => librarySwr.removeChangeCallback(`fileStatus/${file?.id}`)
  }, [file?.id, objectsSwr.mutate])

  return response
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
