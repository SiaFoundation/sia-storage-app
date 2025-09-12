import { useToast } from './toastContext'
import { useFiles } from './filesContext'
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
import { useCallback } from 'react'
import { extFromMime } from './fileTypes'
import { parseFileMetadata } from './file'

export function useDownloadShared() {
  const toast = useToast()
  const { sdk, log } = useSettings()
  const { updateFile } = useFiles()
  return useCallback(
    async (id: string, sharedUrl: string) => {
      try {
        if (!sdk) throw new Error('SDK unavailable')
        toast.show('Starting download...')
        try {
          console.log('sharedUrl', sharedUrl)
          const sharedObject = await sdk.sharedObject(sharedUrl)
          const downloader = await sdk.downloadShared(sharedUrl, {
            maxInflight: 15,
            offset: BigInt(0),
            length: undefined,
          })
          const targetFile = await getOrCreateCachedFile(id, '.tmp')
          log('Writing to cache path:', targetFile.uri)
          const writer = targetFile.writableStream().getWriter()
          let total = 0
          let chunks = 0
          setDownloadState(id, { status: 'downloading', progress: 0 })
          const meta = parseFileMetadata(sharedObject.meta)
          while (true) {
            const chunk = await downloader.readChunk()
            if (!chunk || chunk.byteLength === 0) {
              log('Download stream ended. chunks=', chunks, 'bytes=', total)
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
            if (chunks % 10 === 0) log('Downloaded', total, 'bytes so far')
          }
          await writer.close()
          log('Writer closed. Total bytes:', total)

          await copyFileToCache(id, targetFile, extFromMime(meta.fileType))

          refreshCache(id)

          clearDownloadState(id)
        } catch (inner) {
          log('Download stream error:', String(inner))
          clearDownloadState(id)
          throw inner
        }
        toast.show('Downloaded to cache')
        return id
      } catch (e) {
        log(
          'Download failed for',
          id,
          '-',
          e instanceof Error ? e.message : String(e)
        )
        toast.show('Download failed')
      }
    },
    [sdk, updateFile, toast, log]
  )
}
