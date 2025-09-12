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
import { PinnedObject } from 'react-native-sia'
import { useCallback } from 'react'
import { extFromMime } from './fileTypes'
import { getOnePinnedObject } from './file'
import {
  encryptionKeyHexToBuffer,
  encryptionKeyHexToUint8,
} from './encryptionKey'

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
  const { sdk, log } = useSettings()
  const { updateFile } = useFiles()
  return useCallback(
    async (streamDirectlyToCache?: boolean) => {
      if (!file) return
      try {
        if (!sdk) throw new Error('SDK unavailable')
        if (!file.encryptionKey) throw new Error('Encryption key is required')
        const pinnedObject = getOnePinnedObject(file)
        if (!pinnedObject) {
          toast.show('No slabs available for this file')
          log('Download aborted: no slabs for', file.id)
          return
        }
        toast.show('Starting download...')
        log('Starting download for', file.id)
        log('Slabs type:', JSON.stringify(pinnedObject.slabs, null, 2))
        try {
          console.log('encryptionKey', file.encryptionKey)
          console.log(
            'encryptionKeyBuffer',
            encryptionKeyHexToUint8(file.encryptionKey)
          )
          console.log('file.fileSize', file.fileSize)

          const downloader = await sdk.download(
            encryptionKeyHexToBuffer(file.encryptionKey),
            pinnedObject,
            {
              maxInflight: 15,
              offset: BigInt(0),
              length: undefined,
            }
          )
          console.log('downloader after')
          const targetFile = await getOrCreateCachedFile(
            file.id,
            streamDirectlyToCache ? extFromMime(file.fileType) : '.tmp'
          )
          if (streamDirectlyToCache) {
            refreshCache(file.id)
          }
          log('Writing to cache path:', targetFile.uri)
          const writer = targetFile.writableStream().getWriter()
          let total = 0
          let chunks = 0
          setDownloadState(file.id, { status: 'downloading', progress: 0 })
          const totalLen = Array.isArray(pinnedObject.slabs)
            ? pinnedObject.slabs.reduce((acc, s) => acc + (s?.length ?? 0), 0)
            : undefined
          while (true) {
            console.log('downloading chunk', chunks, total)
            const chunk = await downloader.readChunk()
            if (!chunk || chunk.byteLength === 0) {
              log('Download stream ended. chunks=', chunks, 'bytes=', total)
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
            if (chunks % 10 === 0) log('Downloaded', total, 'bytes so far')
          }
          await writer.close()
          log('Writer closed. Total bytes:', total)

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
          log('Download stream error:', String(inner))
          clearDownloadState(file.id)
          throw inner
        }
        toast.show('Downloaded to cache')
      } catch (e) {
        log(
          'XXX Download failed for',
          file.id,
          '-',
          e instanceof Error ? e.message : String(e)
        )
        toast.show('Download failed')
      }
    },
    [sdk, file, updateFile, toast, log]
  )
}
