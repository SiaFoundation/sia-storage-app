import { useToast } from './toastContext'
import {
  copyFileToCache,
  getOrCreateCachedFile,
  refreshCache,
} from './fileCache'
import {
  setDownloadState,
  updateDownloadProgress,
  clearDownloadState,
} from '../stores/downloadState'
import { useSettings } from './settingsContext'
import { useCallback } from 'react'
import { extFromMime } from './fileTypes'
import { decodeFileMetadata } from './file'
import { logger } from './logger'

export function useDownloadShared() {
  const toast = useToast()
  const { sdk } = useSettings()
  return useCallback(
    async (id: string, sharedUrl: string) => {
      try {
        if (!sdk) throw new Error('SDK unavailable')
        toast.show('Starting download...')
        try {
          const sharedObject = await sdk.sharedObject(sharedUrl)
          const downloader = await sdk.downloadShared(sharedUrl, {
            maxInflight: 15,
            offset: BigInt(0),
            length: undefined,
          })
          const targetFile = await getOrCreateCachedFile(id, '.tmp')
          logger.log('Writing to cache path:', targetFile.uri)
          const writer = targetFile.writableStream().getWriter()
          let total = 0
          let chunks = 0
          setDownloadState(id, { status: 'downloading', progress: 0 })
          const meta = decodeFileMetadata(sharedObject.meta)
          while (true) {
            const chunk = await downloader.readChunk()
            if (!chunk || chunk.byteLength === 0) {
              logger.log(
                'Download stream ended. chunks=',
                chunks,
                'bytes=',
                total
              )
              break
            }
            total += chunk.byteLength
            chunks += 1
            await writer.write(new Uint8Array(chunk))
            // If content length is known in slabs, we can compute %; otherwise, emit rough updates.
            if (meta.size && meta.size > 0) {
              updateDownloadProgress(id, Math.min(1, total / meta.size))
            } else if (chunks % 5 === 0) {
              // Coarse updates when size unknown.
              updateDownloadProgress(id, Math.min(0.99, (chunks % 20) / 20))
            }
            if (chunks % 10 === 0)
              logger.log('Downloaded', total, 'bytes so far')
          }
          await writer.close()
          logger.log('Writer closed. Total bytes:', total)

          await copyFileToCache(id, targetFile, extFromMime(meta.fileType))

          refreshCache(id)

          clearDownloadState(id)
        } catch (inner) {
          logger.log('Download stream error:', String(inner))
          clearDownloadState(id)
          throw inner
        }
        toast.show('Downloaded to cache')
        return id
      } catch (e) {
        logger.log(
          'Download failed for',
          id,
          '-',
          e instanceof Error ? e.message : String(e)
        )
        toast.show('Download failed')
      }
    },
    [sdk, toast, logger.log]
  )
}
