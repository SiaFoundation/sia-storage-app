import { useToast } from '../lib/toastContext'
import { copyFileToCache, getOrCreateCachedFile } from '../stores/fileCache'
import {
  setDownloadState,
  updateDownloadProgress,
  clearDownloadState,
} from '../stores/downloadState'
import { useSettings } from '../lib/settingsContext'
import { type PinnedObject } from 'react-native-sia'
import { useCallback } from 'react'
import { extFromMime, type Ext } from '../lib/fileTypes'
import { getOnePinnedObject } from '../lib/file'
import { encryptionKeyHexToBuffer } from '../lib/encryptionKey'
import { logger } from '../lib/logger'
import { decodeFileMetadata } from '../encoding/fileMetadata'
import { getGlobalSlotPool } from './slotPool'
import { registerTransfer, unregisterTransfer } from '../stores/transfers'

export function useDownload(
  file?: {
    id: string
    fileType: string | null
    fileSize: number | null
    encryptionKey: string
    pinnedObjects: Record<string, PinnedObject> | null
  } | null
) {
  const toast = useToast()
  const { sdk } = useSettings()
  return useCallback(
    async (streamDirectlyToCache?: boolean) => {
      if (!file) return
      // Start progress before entering the slot to reflect queued state.
      setDownloadState(file.id, { status: 'downloading', progress: 0 })
      await getGlobalSlotPool().withSlot(async () => {
        try {
          const pinnedObject = getOnePinnedObject(file)
          if (!pinnedObject) {
            toast.show('No slabs available for this file')
            logger.log('Download aborted: no slabs for', file.id)
            return
          }
          toast.show('Starting download...')
          const controller = registerTransfer(file.id, 'download')
          const downloader = await sdk.download(
            encryptionKeyHexToBuffer(file.encryptionKey),
            pinnedObject,
            {
              maxInflight: 15,
              offset: BigInt(0),
              length: undefined,
            },
            { signal: controller.signal }
          )

          try {
            await streamToCache({
              id: file.id,
              targetExt: streamDirectlyToCache
                ? extFromMime(file.fileType)
                : '.tmp',
              directWrite: Boolean(streamDirectlyToCache),
              getNextChunk: () =>
                downloader.readChunk({ signal: controller.signal }),
              totalSize: Array.isArray(pinnedObject.slabs)
                ? pinnedObject.slabs.reduce(
                    (acc, s) => acc + (s?.length ?? 0),
                    0
                  )
                : undefined,
              onAfterClose: async (targetFile) => {
                if (!streamDirectlyToCache) {
                  await copyFileToCache(
                    file.id,
                    targetFile,
                    extFromMime(file.fileType)
                  )
                }
              },
            })
          } finally {
            unregisterTransfer(file.id)
          }

          toast.show('Downloaded to cache')
        } catch (e) {
          clearDownloadState(file.id)
          logger.log('Download failed for', file.id, e)
        }
      })
    },
    [sdk, file, toast]
  )
}

export function useDownloadFromShareURL() {
  const toast = useToast()
  const { sdk } = useSettings()
  return useCallback(
    async (id: string, sharedUrl: string) => {
      // Start progress before entering the slot to reflect queued state.
      setDownloadState(id, { status: 'downloading', progress: 0 })
      return await getGlobalSlotPool().withSlot(async () => {
        try {
          toast.show('Starting download...')
          const sharedObject = await sdk.sharedObject(sharedUrl)
          const meta = decodeFileMetadata(sharedObject?.meta)
          const downloader = await sdk.downloadShared(sharedUrl, {
            maxInflight: 15,
            offset: BigInt(0),
            length: undefined,
          })

          await streamToCache({
            id,
            targetExt: '.tmp',
            getNextChunk: () => downloader.readChunk(),
            totalSize: meta.size,
            onAfterClose: async (targetFile) => {
              await copyFileToCache(id, targetFile, extFromMime(meta.fileType))
            },
          })

          toast.show('Downloaded to cache')
          return id
        } catch (e) {
          clearDownloadState(id)
          logger.log('Download failed for', id, e)
        }
      })
    },
    [sdk, toast]
  )
}

async function streamToCache(params: {
  id: string
  targetExt: Ext
  directWrite?: boolean
  totalSize?: number
  getNextChunk: () => Promise<ArrayBuffer | undefined>
  onAfterClose?: (
    targetFile: Awaited<ReturnType<typeof getOrCreateCachedFile>>
  ) => Promise<void>
}): Promise<void> {
  const { id, targetExt, directWrite, totalSize, getNextChunk, onAfterClose } =
    params
  const targetFile = await getOrCreateCachedFile(id, targetExt, directWrite)
  logger.log('Writing to cache path:', targetFile.uri)
  const writer = targetFile.writableStream().getWriter()
  let total = 0
  let chunks = 0
  setDownloadState(id, { status: 'downloading', progress: 0 })
  try {
    while (true) {
      const chunk = await getNextChunk()
      if (!chunk || (chunk as ArrayBuffer).byteLength === 0) {
        logger.log('Download stream ended. chunks=', chunks, 'bytes=', total)
        break
      }
      const buf = new Uint8Array(chunk as ArrayBuffer)
      total += buf.byteLength
      chunks += 1
      await writer.write(buf)
      if (typeof totalSize === 'number' && totalSize > 0) {
        updateDownloadProgress(id, Math.min(1, total / totalSize))
      } else if (chunks % 5 === 0) {
        updateDownloadProgress(id, Math.min(0.99, (chunks % 20) / 20))
      }
      if (chunks % 10 === 0) logger.log('Downloaded', total, 'bytes so far')
    }
  } finally {
    await writer.close()
    logger.log('Writer closed. Total bytes:', total)
    clearDownloadState(id)
  }
  if (onAfterClose) {
    await onAfterClose(targetFile)
  }
}
