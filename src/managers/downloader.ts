import { useToast } from '../lib/toastContext'
import { copyFileToCache, getOrCreateCachedFile } from '../stores/fileCache'
import { updateDownloadProgress } from '../stores/transfers'
import { useSdk } from '../stores/auth'
import { type PinnedObject } from 'react-native-sia'
import { useCallback } from 'react'
import { extFromMime, type Ext } from '../lib/fileTypes'
import { getOnePinnedObject } from '../lib/file'
import { encryptionKeyHexToBuffer } from '../lib/encryptionKey'
import { logger } from '../lib/logger'
import { decodeFileMetadata } from '../encoding/fileMetadata'
import { runTransferWithSlot } from '../stores/transfers'

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
  const sdk = useSdk()
  return useCallback(async () => {
    if (!file) return
    if (!sdk) return
    const pinnedObject = getOnePinnedObject(file)
    if (!pinnedObject) {
      toast.show('No slabs available for this file')
      return
    }
    toast.show('Starting download...')
    await runTransferWithSlot({
      id: file.id,
      kind: 'download',
      task: async (signal) => {
        if (!sdk) throw new Error('SDK not initialized')
        const downloader = await sdk.download(
          encryptionKeyHexToBuffer(file.encryptionKey),
          pinnedObject,
          {
            maxInflight: 15,
            offset: BigInt(0),
            length: undefined,
          },
          { signal }
        )
        await streamToCache({
          id: file.id,
          targetExt: '.tmp',
          getNextChunk: () => downloader.readChunk({ signal }),
          totalSize: Array.isArray(pinnedObject.slabs)
            ? pinnedObject.slabs.reduce((acc, s) => acc + (s?.length ?? 0), 0)
            : undefined,
          onAfterClose: async (targetFile) => {
            await copyFileToCache(
              file.id,
              targetFile,
              extFromMime(file.fileType)
            )
          },
        })
        toast.show('Downloaded to cache')
      },
    })
  }, [sdk, file, toast])
}

export function useDownloadFromShareURL() {
  const toast = useToast()
  const sdk = useSdk()
  return useCallback(
    async (id: string, sharedUrl: string) =>
      runTransferWithSlot({
        id,
        kind: 'download',
        task: async (signal) => {
          toast.show('Starting download...')
          if (!sdk) throw new Error('SDK not initialized')
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
            getNextChunk: () => downloader.readChunk({ signal }),
            totalSize: meta.size,
            onAfterClose: async (targetFile) => {
              await copyFileToCache(id, targetFile, extFromMime(meta.fileType))
            },
          })
          toast.show('Downloaded to cache')
          return id
        },
      }),
    [sdk, toast]
  )
}

async function streamToCache(params: {
  id: string
  targetExt: Ext
  totalSize?: number
  getNextChunk: () => Promise<ArrayBuffer | undefined>
  onAfterClose?: (
    targetFile: Awaited<ReturnType<typeof getOrCreateCachedFile>>
  ) => Promise<void>
}): Promise<void> {
  const { id, targetExt, totalSize, getNextChunk, onAfterClose } = params
  const targetFile = await getOrCreateCachedFile(id, targetExt)
  logger.log('[streamToCache] writing to cache path:', targetFile.uri)
  const writer = targetFile.writableStream().getWriter()
  let total = 0
  let chunks = 0
  try {
    while (true) {
      const chunk = await getNextChunk()
      if (!chunk || (chunk as ArrayBuffer).byteLength === 0) {
        logger.log(
          '[streamToCache] download stream ended. chunks=',
          chunks,
          'bytes=',
          total
        )
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
      if (chunks % 10 === 0)
        logger.log('[streamToCache] downloaded', total, 'bytes so far')
    }
  } finally {
    await writer.close()
    logger.log('[streamToCache] writer closed. Total bytes:', total)
  }
  if (onAfterClose) {
    await onAfterClose(targetFile)
  }
}
