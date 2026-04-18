import { useIsInitializing } from '@siastorage/core/stores'
import type { FileRecord, ThumbSize } from '@siastorage/core/types'
import { useEffect } from 'react'
import useSWR from 'swr'
import { useFileStatus } from '../lib/file'
import { useDownload } from '../managers/downloader'
import { app } from '../stores/appService'
import { useFsFileUri } from '../stores/fs'
import { useIsConnected } from '../stores/sdk'

/**
 * useBestThumbnailUri returns the local URI of the best available thumbnail for a file.
 *
 * Behavior:
 * - Only considers thumbnails with thumbSize <= requested size.
 * - Picks the largest thumbSize that does not exceed the requested size.
 * - Returns null if no qualifying thumbnail exists.
 * - If a best thumbnail exists on the network but is not cached locally,
 *   this hook will auto-download it.
 */
export function useBestThumbnailUri(file?: FileRecord, thumbSize: ThumbSize = 512) {
  // Skip thumbnail lookup for files still being imported (no hash yet).
  const isImported = !!file && file.hash !== ''
  const thumbRecord = useSWR(
    isImported ? app().caches.thumbnails.best.key(file.id, String(thumbSize)) : null,
    () => (file ? app().thumbnails.getBest(file.id, thumbSize) : null),
  )

  // Auto-download the chosen thumbnail at auto priority.
  const isInitializing = useIsInitializing()
  const isConnected = useIsConnected()
  const status = useFileStatus(thumbRecord.data ?? undefined)
  const download = useDownload(thumbRecord.data, 1)
  useEffect(() => {
    if (isInitializing) return
    if (!isConnected) return
    if (!thumbRecord.data) return
    if (!status.data?.isUploaded) return
    if (status.data?.isDownloaded) return
    if (status.data?.isDownloading) return
    download()
  }, [isInitializing, isConnected, thumbRecord.data, status.data, download])

  // Get the URI via fsFileUriCache which receives synchronous pushes from
  // copyFileToFs — no async gap between download completing and URI appearing.
  return useFsFileUri(thumbRecord.data ?? undefined)
}
