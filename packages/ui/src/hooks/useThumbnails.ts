import { useApp } from '@siastorage/core/stores'
import { logger } from '@siastorage/logger'
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePlatform } from '../context/platform'

export function useThumbnails(fileIds: string[]) {
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({})
  const thumbnailUrlsRef = useRef<Record<string, string>>({})
  const loadingRef = useRef<Set<string>>(new Set())
  const noThumbnailRef = useRef<Set<string>>(new Set())
  const platform = usePlatform()
  const app = useApp()

  useEffect(() => {
    if (fileIds.length === 0) return
    let cancelled = false

    async function loadThumbnails() {
      for (const fileId of fileIds) {
        if (cancelled) break
        if (
          thumbnailUrlsRef.current[fileId] ||
          loadingRef.current.has(fileId) ||
          noThumbnailRef.current.has(fileId)
        )
          continue

        loadingRef.current.add(fileId)
        try {
          const thumb = await app.thumbnails.getBest(fileId, 512)
          if (!thumb) {
            noThumbnailRef.current.add(fileId)
            continue
          }

          const thumbObjects = await app.localObjects.getForFile(thumb.id)
          if (thumbObjects.length === 0) {
            noThumbnailRef.current.add(fileId)
            continue
          }

          await app.downloads.downloadFile(thumb.id)
          const data = await app.downloads.readFile(thumb.id)
          if (cancelled) break
          if (!data) {
            noThumbnailRef.current.add(fileId)
            continue
          }
          const url = platform.createBlobUrl(data, thumb.type)
          thumbnailUrlsRef.current[fileId] = url
          setThumbnailUrls((prev) => ({ ...prev, [fileId]: url }))
        } catch (e) {
          logger.error('library', 'thumbnail_error', {
            fileId,
            error: e as Error,
          })
        } finally {
          loadingRef.current.delete(fileId)
        }
      }
    }

    loadThumbnails()
    return () => {
      cancelled = true
    }
  }, [fileIds, app, platform])

  useEffect(() => {
    return () => {
      for (const url of Object.values(thumbnailUrlsRef.current)) {
        URL.revokeObjectURL(url)
      }
    }
  }, [])

  const addLocalThumbnails = useCallback((urls: Record<string, string>) => {
    for (const [id, url] of Object.entries(urls)) {
      thumbnailUrlsRef.current[id] = url
    }
    setThumbnailUrls((prev) => ({ ...prev, ...urls }))
  }, [])

  return { thumbnailUrls, addLocalThumbnails }
}
