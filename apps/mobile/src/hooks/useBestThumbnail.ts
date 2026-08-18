import { useIsInitializing } from '@siastorage/core/stores'
import type { FileRecord, ThumbSize } from '@siastorage/core/types'
import { useEffect } from 'react'
import useSWR from 'swr'
import { useFileStatus } from '../lib/file'
import { getOsThumbnailUri } from '../lib/mediaLibrary'
import { useDownload } from '../managers/downloader'
import { app } from '../stores/appService'
import { useFsFileUri } from '../stores/fs'
import { useIsConnected } from '../stores/sdk'

/**
 * The generated-thumbnail half of [useThumbnailUri], which is the hook to
 * call. This one resolves no fallback, so on its own it leaves a file
 * without a thumbnail yet with nothing to draw.
 *
 * Returns the local URI of the largest cached thumbnail that does not exceed
 * the requested size, or null when the file has none. A thumbnail that is on
 * the network but not cached is downloaded at auto priority.
 */
function useBestThumbnailUri(file?: FileRecord, thumbSize: ThumbSize = 512) {
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
    if (!status.data?.canAutoFetch) return
    if (status.data.download.state !== 'idle') return
    download()
  }, [isInitializing, isConnected, thumbRecord.data, status.data, download])

  // Get the URI via app.caches.fsFileUri which receives synchronous pushes from
  // copyFileToFs — no async gap between download completing and URI appearing.
  return useFsFileUri(thumbRecord.data ?? undefined)
}

export type ResolvedThumbnail = {
  /** URI to render, or null when only the placeholder icon should show. */
  uri: string | null
  /** True when `uri` is an OS photo-library tile rather than a real thumb. */
  isOsFallback: boolean
  /** Call from the image's `onError` while an OS fallback is showing. */
  onOsError: () => void
}

/**
 * Resolves what a file's thumbnail cell should render: the real cached
 * `kind='thumb'` when present, otherwise the OS photo-library tile while the
 * file is still importing and has a source asset (`mediaAssetId`).
 *
 * The OS lookup is gated on the real thumb being absent, so files that
 * already have a thumbnail never touch the photo library. A failed lookup
 * (deleted asset, no cached tile) — whether it fails at resolution or at
 * image load (`onOsError`) — is cached as null and never retried; the
 * asset's URI is stable, so there is nothing to revalidate.
 */
export function useThumbnailUri(file?: FileRecord, thumbSize: ThumbSize = 512): ResolvedThumbnail {
  const best = useBestThumbnailUri(file, thumbSize)
  const mediaAssetId = file?.mediaAssetId ?? null
  const osKey = !best.data && mediaAssetId ? (['os-thumb-uri', mediaAssetId] as const) : null
  const { data: osUri, mutate: mutateOs } = useSWR(osKey, () => getOsThumbnailUri(mediaAssetId), {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
  })

  const osFallbackUri = best.data ? null : (osUri ?? null)
  return {
    uri: best.data ?? osFallbackUri,
    isOsFallback: !!osFallbackUri,
    onOsError: () => {
      mutateOs(null, { revalidate: false })
    },
  }
}
