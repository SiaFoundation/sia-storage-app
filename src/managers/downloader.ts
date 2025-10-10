import { useToast } from '../lib/toastContext'
import { copyFileToCache, getOrCreateCachedFile } from '../stores/fileCache'
import {
  getDownloadState,
  updateDownloadProgress,
  runDownloadWithSlot,
} from '../stores/downloads'
import { useSdk } from '../stores/sdk'
import { PinnedObject, SealedObject } from 'react-native-sia'
import { useCallback } from 'react'
import { extFromMime, type Ext } from '../lib/fileTypes'
import { getOneSealedObject } from '../lib/file'
import { logger } from '../lib/logger'
import { decodeFileMetadata } from '../encoding/fileMetadata'
import { DOWNLOAD_MAX_INFLIGHT } from '../config'
import { getAppKey } from '../lib/appKey'

export function useDownload(
  file?: {
    id: string
    fileType: string | null
    fileSize: number | null
    sealedObjects: Record<string, SealedObject> | null
  } | null
) {
  const toast = useToast()
  const sdk = useSdk()
  return useCallback(async () => {
    if (!file) return
    if (!sdk) return
    const sealedObject = getOneSealedObject(file)
    if (!sealedObject) {
      toast.show('No slabs available for this file')
      return
    }
    const downloadState = getDownloadState(file.id)
    if (
      downloadState?.status === 'running' ||
      downloadState?.status === 'queued'
    ) {
      return
    }
    await runDownloadWithSlot({
      id: file.id,
      task: async (signal) => {
        if (!sdk) throw new Error('SDK not initialized')
        const appKey = await getAppKey()
        const downloader = sdk.download(
          PinnedObject.open(appKey, sealedObject),
          {
            maxInflight: DOWNLOAD_MAX_INFLIGHT,
            offset: BigInt(0),
            length: undefined,
          }
        )
        await streamToCache({
          id: file.id,
          targetExt: '.tmp',
          getNextChunk: () => downloader.readChunk({ signal }),
          totalSize: Array.isArray(sealedObject.slabs)
            ? sealedObject.slabs.reduce((acc, s) => acc + (s?.length ?? 0), 0)
            : undefined,
          onAfterClose: async (targetFile) => {
            await copyFileToCache(
              file.id,
              targetFile,
              extFromMime(file.fileType)
            )
          },
          signal,
        })
      },
    })
  }, [sdk, file, toast])
}

export function useDownloadFromShareURL() {
  const sdk = useSdk()
  return useCallback(
    async (id: string, sharedUrl: string) =>
      runDownloadWithSlot({
        id,
        task: async (signal) => {
          if (!sdk) throw new Error('SDK not initialized')
          const sharedObject = await sdk.sharedObject(sharedUrl)
          const metadata = decodeFileMetadata(sharedObject.metadata())
          const downloader = sdk.downloadShared(sharedObject, {
            maxInflight: DOWNLOAD_MAX_INFLIGHT,
            offset: BigInt(0),
            length: undefined,
          })
          await streamToCache({
            id,
            targetExt: '.tmp',
            getNextChunk: () => downloader.readChunk({ signal }),
            totalSize: Number(sharedObject.size()),
            onAfterClose: async (targetFile) => {
              await copyFileToCache(
                id,
                targetFile,
                extFromMime(metadata.fileType)
              )
            },
            signal,
          })
          return id
        },
      }),
    [sdk]
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
  signal: AbortSignal
}): Promise<void> {
  const { id, targetExt, totalSize, getNextChunk, onAfterClose, signal } =
    params
  const targetFile = await getOrCreateCachedFile(id, targetExt)
  logger.log('[streamToCache] writing to cache path:', targetFile.uri)
  const writer = targetFile.writableStream().getWriter()
  let total = 0
  let chunks = 0
  try {
    while (true) {
      if (signal.aborted) {
        logger.log('[streamToCache] abort received, stopping download...')
        targetFile.delete()
        break
      }
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
