import { useEffect } from 'react'
import { useFileStatus } from '../lib/file'
import { useIsInitializing } from '../stores/app'
import { useIsConnected } from '../stores/sdk'
import { useDownload, useDownloadFromShareURL } from '../managers/downloader'
import { FileRecord } from '../stores/files'

/**
 * When a file is rendered in a thumbnail view, auto download it if:
 * its an image or PDF, or its less than 4 MB.
 */
export function thumbnailShouldAutoDownload(file: FileRecord): boolean {
  const isImage = file.type?.startsWith('image') ?? false
  const isPdf = (file.type ?? '').includes('pdf')
  const sizeOk = (file.size ?? Infinity) <= 4 * 1000 * 1000 // 4 MB
  return isImage || isPdf || sizeOk
}

/**
 * When a file is rendered in a detail view, auto download it if:
 * its an image, PDF, or its less than 10 MB.
 */
export function detailsShouldAutoDownload(file: FileRecord): boolean {
  const isImage = file.type?.startsWith('image') ?? false
  const isPdf = (file.type ?? '').includes('pdf')
  const sizeOk = (file.size ?? Infinity) <= 10 * 1000 * 1000 // 10 MB
  return isImage || isPdf || sizeOk
}

export function useAutoDownload(
  file: FileRecord,
  shouldDownload: (file: FileRecord) => boolean
): void {
  const isInitializing = useIsInitializing()
  const isConnected = useIsConnected()
  const download = useDownload(file)
  const status = useFileStatus(file)
  useEffect(() => {
    if (isInitializing) return
    if (!isConnected) return
    if (!file) return
    if (!status.data) return
    if (!status.data.isUploaded) return
    if (status.data.isDownloaded) return
    if (status.data.isDownloading) return
    if (file.localId) return
    if (!shouldDownload(file)) return
    download()
  }, [isInitializing, isConnected, status.data])
}

export function useAutoDownloadFromShareURL(
  file: FileRecord,
  shouldDownload: (file: FileRecord) => boolean,
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
    if (!status.data) return
    if (!status.data.isUploaded) return
    if (status.data.isDownloaded) return
    if (status.data.isDownloading) return
    if (!shouldDownload(file)) return
    download(file.id, shareUrl)
  }, [isInitializing, isConnected, status.data])
}
