import { useToast } from '../lib/toastContext'
import { copyFileToFs } from '../stores/fs'
import { getOrCreateTempDownloadFile } from '../stores/tempFs'
import {
  getDownloadState,
  updateDownloadProgress,
  runDownloadWithSlot,
} from '../stores/downloads'
import { useSdk, getSdk } from '../stores/sdk'
import { PinnedObject } from 'react-native-sia'
import { useCallback } from 'react'
import { getOneSealedObject } from '../lib/file'
import { logger } from '../lib/logger'
import { DOWNLOAD_MAX_INFLIGHT } from '../config'
import { getAppKeyForIndexer } from '../stores/appKey'
import { FileRecord } from '../stores/files'
import { File } from 'expo-file-system'
import { type SharedObjectInterface } from 'react-native-sia'

/** Non-hook version for programmatic downloads (e.g., bulk operations) */
export async function downloadFile(file: FileRecord): Promise<void> {
  const sdk = getSdk()
  if (!sdk) throw new Error('SDK not initialized')

  const result = getOneSealedObject(file)
  if (!result) {
    throw new Error('No slabs available for this file')
  }

  const { indexerURL, sealedObject } = result
  const downloadState = getDownloadState(file.id)
  if (
    downloadState?.status === 'running' ||
    downloadState?.status === 'queued'
  ) {
    return // Already downloading
  }

  await runDownloadWithSlot({
    id: file.id,
    task: async (signal) => {
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
}

export function useDownload(file?: FileRecord | null) {
  const toast = useToast()
  const sdk = useSdk()
  return useCallback(() => {
    if (!file) return
    if (!sdk) return
    // Check for slabs synchronously before queueing
    const sealedObject = getOneSealedObject(file)
    if (!sealedObject) {
      toast.show('No slabs available for this file')
      return
    }
    // Fire and forget - queue the download
    downloadFile(file)
    toast.show('Download queued')
  }, [sdk, file, toast])
}

export function useDownloadFromShareURL() {
  const sdk = useSdk()
  return useCallback(
    async (id: string, sharedUrl: string) => {
      // Check if download is already running or queued.
      const downloadState = getDownloadState(id)
      if (
        downloadState?.status === 'running' ||
        downloadState?.status === 'queued'
      ) {
        logger.debug(
          'useDownloadFromShareURL',
          'download already in progress',
          id
        )
        return id
      }

      return runDownloadWithSlot({
        id,
        task: async (signal) => {
          if (!sdk) throw new Error('SDK not initialized')
          const sharedObject = await sdk.sharedObject(sharedUrl)
          const downloader = await sdk.downloadShared(sharedObject, {
            maxInflight: DOWNLOAD_MAX_INFLIGHT,
            offset: BigInt(0),
            length: undefined,
          })
          // Create a minimal file record for downloading
          // The actual metadata will be extracted from the downloaded file
          const file: FileRecord = {
            id,
            name: 'Shared File',
            type: 'application/octet-stream',
            size: Number(sharedObject.size()),
            hash: '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            localId: null,
            addedAt: Date.now(),
            objects: {},
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
      })
    },
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
  logger.debug('streamToCache', 'writing to cache path:', targetFile.uri)
  const writer = targetFile.writableStream().getWriter()
  let total = 0
  let chunks = 0
  try {
    while (true) {
      if (signal.aborted) {
        logger.debug('streamToCache', 'abort received, stopping download...')
        targetFile.delete()
        break
      }
      const chunk = await getNextChunk()
      if (!chunk || chunk.byteLength === 0) {
        logger.debug(
          'streamToCache',
          'download stream ended. chunks=',
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
        logger.debug('streamToCache', 'downloaded', total, 'bytes so far')
    }
  } finally {
    await writer.close()
    logger.debug('streamToCache', 'writer closed. Total bytes:', total)
  }
  if (onAfterClose) {
    await onAfterClose(targetFile)
  }
}

/**
 * Download only the first N bytes from a shared object for type detection.
 * Returns the bytes as a Uint8Array.
 */
export async function downloadFirstBytesFromShared(
  sdk: ReturnType<typeof useSdk>,
  sharedObject: SharedObjectInterface,
  byteCount: number
): Promise<Uint8Array> {
  if (!sdk) {
    throw new Error('SDK not initialized')
  }

  logger.debug(
    'downloadFirstBytesFromShared',
    `Downloading first ${byteCount} bytes`
  )

  // Download only first N bytes for type detection.
  const downloader = await sdk.downloadShared(sharedObject, {
    maxInflight: DOWNLOAD_MAX_INFLIGHT,
    offset: BigInt(0),
    length: BigInt(byteCount),
  })

  // Read the bytes.
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  const abortController = new AbortController()

  try {
    while (totalBytes < byteCount) {
      const chunk = await downloader.readChunk({
        signal: abortController.signal,
      })
      if (!chunk || chunk.byteLength === 0) break

      const buf = new Uint8Array(chunk)
      chunks.push(buf)
      totalBytes += buf.length
      if (totalBytes >= byteCount) break
    }
  } finally {
    // Abort the download after we have enough bytes.
    abortController.abort()
  }

  // Combine chunks and take only the requested number of bytes.
  const bytes = new Uint8Array(Math.min(totalBytes, byteCount))
  let offset = 0
  for (const chunk of chunks) {
    const toCopy = Math.min(chunk.length, byteCount - offset)
    bytes.set(chunk.slice(0, toCopy), offset)
    offset += toCopy
    if (offset >= byteCount) break
  }

  logger.debug(
    'downloadFirstBytesFromShared',
    `Downloaded ${bytes.length} bytes`
  )
  return bytes
}
