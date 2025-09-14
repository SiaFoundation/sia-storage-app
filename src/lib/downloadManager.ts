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
} from './downloadState'
import { useSettings } from './settingsContext'
import { PinnedObject } from 'react-native-sia'
import { useCallback } from 'react'
import { extFromMime } from './fileTypes'
import { getOnePinnedObject } from './file'
import { encryptionKeyHexToBuffer } from './encryptionKey'
import { logger } from './logger'

export function useDownload(
  file?: {
    id: string
    fileType: string | null
    fileSize: number | null
    encryptionKey: string | null
    pinnedObjects: Record<string, PinnedObject> | null
  } | null
) {
  const toast = useToast()
  const { sdk } = useSettings()
  return useCallback(
    async (streamDirectlyToCache?: boolean) => {
      if (!file) return
      try {
        if (!sdk) throw new Error('SDK unavailable')
        if (!file.encryptionKey) throw new Error('Encryption key is required')
        const pinnedObject = getOnePinnedObject(file)
        if (!pinnedObject) {
          toast.show('No slabs available for this file')
          logger.log('Download aborted: no slabs for', file.id)
          return
        }
        toast.show('Starting download...')
        try {
          const downloader = await sdk.download(
            encryptionKeyHexToBuffer(file.encryptionKey),
            pinnedObject,
            {
              maxInflight: 15,
              offset: BigInt(0),
              length: undefined,
            }
          )
          const targetFile = await getOrCreateCachedFile(
            file.id,
            streamDirectlyToCache ? extFromMime(file.fileType) : '.tmp'
          )
          if (streamDirectlyToCache) {
            refreshCache(file.id)
          }
          logger.log('Writing to cache path:', targetFile.uri)
          const writer = targetFile.writableStream().getWriter()
          let total = 0
          let chunks = 0
          setDownloadState(file.id, { status: 'downloading', progress: 0 })
          const totalLen = Array.isArray(pinnedObject.slabs)
            ? pinnedObject.slabs.reduce((acc, s) => acc + (s?.length ?? 0), 0)
            : undefined
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
            if (totalLen && totalLen > 0) {
              updateDownloadProgress(file.id, Math.min(1, total / totalLen))
            } else if (chunks % 5 === 0) {
              // Coarse updates when size unknown.
              updateDownloadProgress(
                file.id,
                Math.min(0.99, (chunks % 20) / 20)
              )
            }
            if (chunks % 10 === 0)
              logger.log('Downloaded', total, 'bytes so far')
          }
          await writer.close()
          logger.log('Writer closed. Total bytes:', total)

          if (!streamDirectlyToCache) {
            await copyFileToCache(
              file.id,
              targetFile,
              extFromMime(file.fileType)
            )
          }

          refreshCache(file.id)

          clearDownloadState(file.id)
        } catch (inner) {
          logger.log('Download stream error:', String(inner))
          clearDownloadState(file.id)
          throw inner
        }
        toast.show('Downloaded to cache')
      } catch (e) {
        logger.log(
          'Download failed for',
          file.id,
          '-',
          e instanceof Error ? e.message : String(e)
        )
        toast.show('Download failed')
      }
    },
    [sdk, file, toast]
  )
}
