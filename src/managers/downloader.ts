import { useToast } from '../lib/toastContext'
import { copyFileToFs } from '../stores/fs'
import { getOrCreateTempDownloadFile } from '../stores/tempFs'
import {
  getDownloadState,
  updateDownloadProgress,
  runDownloadWithSlot,
} from '../stores/downloads'
import { useSdk } from '../stores/sdk'
import { PinnedObject } from 'react-native-sia'
import { useCallback } from 'react'
import { getOneSealedObject } from '../lib/file'
import { logger } from '../lib/logger'
import { decodeFileMetadata } from '../encoding/fileMetadata'
import { DOWNLOAD_MAX_INFLIGHT } from '../config'
import { getAppKeyForIndexer } from '../stores/appKey'
import { FileLocalMetadata, FileRecord } from '../stores/files'
import { File } from 'expo-file-system'

export function useDownload(file?: FileRecord | null) {
  const toast = useToast()
  const sdk = useSdk()
  return useCallback(async () => {
    if (!file) return
    if (!sdk) return
    const result = getOneSealedObject(file)
    if (!result) {
      toast.show('No slabs available for this file')
      return
    }
    const { indexerURL, sealedObject } = result
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
        const appKey = await getAppKeyForIndexer(indexerURL)
        if (!appKey) {
          throw new Error(`No AppKey found for indexer: ${indexerURL}`)
        }
        const downloader = await sdk.download(
          PinnedObject.open(appKey, sealedObject),
          {
            maxInflight: DOWNLOAD_MAX_INFLIGHT,
            offset: BigInt(0),
            length: undefined,
          }
        )
        await streamToCache({
          file,
          getNextChunk: () => downloader.readChunk({ signal }),
          totalSize: Array.isArray(sealedObject.slabs)
            ? sealedObject.slabs.reduce((acc, s) => acc + (s?.length ?? 0), 0)
            : undefined,
          onAfterClose: async (targetFile) => {
            await copyFileToFs(file, targetFile)
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
          const downloader = await sdk.downloadShared(sharedObject, {
            maxInflight: DOWNLOAD_MAX_INFLIGHT,
            offset: BigInt(0),
            length: undefined,
          })
          const localMetadata: FileLocalMetadata = {
            id,
            localId: null,
            addedAt: Date.now(),
          }
          const file: FileRecord = {
            ...metadata,
            ...localMetadata,
            objects: {},
            id,
          }
          await streamToCache({
            file,
            getNextChunk: () => downloader.readChunk({ signal }),
            totalSize: Number(sharedObject.size()),
            onAfterClose: async (targetFile) => {
              await copyFileToFs(file, targetFile)
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
  file: FileRecord
  totalSize?: number
  getNextChunk: () => Promise<ArrayBuffer | undefined>
  onAfterClose?: (targetFile: File) => Promise<void>
  signal: AbortSignal
}): Promise<void> {
  const { file, totalSize, getNextChunk, onAfterClose, signal } = params
  const targetFile = await getOrCreateTempDownloadFile(file)
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
      if (!chunk || chunk.byteLength === 0) {
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
        updateDownloadProgress(file.id, Math.min(1, total / totalSize))
      } else if (chunks % 5 === 0) {
        updateDownloadProgress(file.id, Math.min(0.99, (chunks % 20) / 20))
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
