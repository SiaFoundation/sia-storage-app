import { useEffect } from 'react'
import useSWR from 'swr'
import { useFileStatus } from '../lib/file'
import { useDownload } from '../managers/downloader'
import { useIsInitializing } from '../stores/app'
import type { FileRecord, ThumbSize } from '../stores/files'
import { getFsFileUri } from '../stores/fs'
import { useIsConnected } from '../stores/sdk'
import { readBestThumbnailByHash, thumbnailSwr } from '../stores/thumbnails'

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
export function useBestThumbnailUri(
  file?: FileRecord,
  thumbSize: ThumbSize = 512,
) {
  // Fetch the best thumbnail record.
  const thumbRecord = useSWR(
    file ? thumbnailSwr.getKey(`${file.hash}/${thumbSize}/record`) : null,
    () => (file ? readBestThumbnailByHash(file.hash, thumbSize) : null),
  )

  // Auto-download the chosen thumbnail.
  const isInitializing = useIsInitializing()
  const isConnected = useIsConnected()
  const status = useFileStatus(thumbRecord.data ?? undefined)
  const download = useDownload(thumbRecord.data)
  useEffect(() => {
    if (isInitializing) return
    if (!isConnected) return
    if (!thumbRecord.data) return
    if (!status.data?.isUploaded) return
    if (status.data?.isDownloaded) return
    if (status.data?.isDownloading) return
    download()
  }, [isInitializing, isConnected, thumbRecord.data, status.data, download])

  // Get the URI for the thumbnail.
  const response = useSWR(
    file ? thumbnailSwr.getKey(`${file.hash}/${thumbSize}/uri`) : null,
    async () => {
      if (!thumbRecord.data) return null
      return await getFsFileUri(thumbRecord.data)
    },
  )
  // Update when status changes so the thumbnail is re-rendered when the uri becomes available.
  // biome-ignore lint/correctness/useExhaustiveDependencies: status.data triggers mutate intentionally
  useEffect(() => {
    response.mutate()
  }, [status.data])
  return response
}
