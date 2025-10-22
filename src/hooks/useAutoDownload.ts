import { useEffect } from 'react'
import { useFileStatus } from '../lib/file'
import { useIsInitializing } from '../stores/app'
import { useIsConnected } from '../stores/sdk'
import { useDownload, useDownloadFromShareURL } from '../managers/downloader'
import { LocalObjectsMap } from '../encoding/localObject'

/**
 * When a file is rendered in a thumbnail view, auto download it if:
 * its an image or PDF, or its less than 4 MB.
 */
export function thumbnailShouldAutoDownload(file: {
  fileType: string | null
  fileSize: number | null
}): boolean {
  const isImage = file.fileType?.startsWith('image') ?? false
  const isPdf = (file.fileType ?? '').includes('pdf')
  const sizeOk = (file.fileSize ?? Infinity) <= 4 * 1000 * 1000 // 4 MB
  return isImage || isPdf || sizeOk
}

/**
 * When a file is rendered in a detail view, auto download it if:
 * its an image, PDF, or its less than 10 MB.
 */
export function detailsShouldAutoDownload(file: {
  fileType: string | null
  fileSize: number | null
}): boolean {
  const isImage = file.fileType?.startsWith('image') ?? false
  const isPdf = (file.fileType ?? '').includes('pdf')
  const sizeOk = (file.fileSize ?? Infinity) <= 10 * 1000 * 1000 // 10 MB
  return isImage || isPdf || sizeOk
}

export function useAutoDownload(
  file: {
    id: string
    fileType: string | null
    fileSize: number | null
    localId: string | null
    objects: LocalObjectsMap | null
  },
  shouldDownload: (file: {
    fileType: string | null
    fileSize: number | null
  }) => boolean
): void {
  const isInitializing = useIsInitializing()
  const isConnected = useIsConnected()
  const download = useDownload(file)
  const status = useFileStatus(file ?? undefined)
  useEffect(() => {
    if (isInitializing) return
    if (!isConnected) return
    if (!file) return
    if (!status.isUploaded) return
    if (status.isDownloaded) return
    if (status.isDownloading) return
    if (file.localId) return
    if (!shouldDownload(file)) return
    download()
  }, [isInitializing, isConnected, status.isUploaded])
}

export function useAutoDownloadFromShareURL(
  file: {
    id: string
    fileType: string | null
    fileSize: number | null
  },
  shouldDownload: (file: {
    fileType: string | null
    fileSize: number | null
  }) => boolean,
  shareUrl: string
): void {
  const isInitializing = useIsInitializing()
  const isConnected = useIsConnected()
  const download = useDownloadFromShareURL()
  const status = useFileStatus(file)
  useEffect(() => {
    if (isInitializing) return
    if (!isConnected) return
    if (!file) return
    if (!status.isUploaded) return
    if (status.isDownloaded) return
    if (status.isDownloading) return
    if (!shouldDownload(file)) return
    download(file.id, shareUrl)
  }, [isInitializing, isConnected, status.isUploaded])
}
