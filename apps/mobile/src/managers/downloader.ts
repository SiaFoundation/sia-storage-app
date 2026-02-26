import { DOWNLOAD_MAX_INFLIGHT } from '@siastorage/core/config'
import { logger } from '@siastorage/logger'
import type { File } from 'expo-file-system'
import { useCallback } from 'react'
import {
  PinnedObject,
  type PinnedObjectInterface,
  type Writer,
} from 'react-native-sia'
import { getOneSealedObject } from '../lib/file'
import { useToast } from '../lib/toastContext'
import { getAppKeyForIndexer } from '../stores/appKey'
import {
  getDownloadState,
  runDownloadWithSlot,
  updateDownloadProgress,
} from '../stores/downloads'
import type { FileRecord } from '../stores/files'
import { copyFileToFs } from '../stores/fs'
import { getSdk, useSdk } from '../stores/sdk'
import { getOrCreateTempDownloadFile } from '../stores/tempFs'

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
    return // Already downloading or just completed
  }

  await runDownloadWithSlot({
    id: file.id,
    task: async (signal) => {
      const appKey = await getAppKeyForIndexer(indexerURL)
      if (!appKey) {
        throw new Error(`No AppKey found for indexer: ${indexerURL}`)
      }
      const pinnedObject = PinnedObject.open(appKey, sealedObject)
      const totalSize = Array.isArray(sealedObject.slabs)
        ? sealedObject.slabs.reduce((acc, s) => acc + (s?.length ?? 0), 0)
        : undefined

      await streamToCache({
        file,
        pinnedObject,
        totalSize,
        download: (writer) =>
          sdk.download(
            writer,
            pinnedObject,
            {
              maxInflight: DOWNLOAD_MAX_INFLIGHT,
              offset: BigInt(0),
              length: undefined,
            },
            { signal },
          ),
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
    downloadFile(file)
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
        logger.debug('useDownloadFromShareURL', 'already_in_progress', { id })
        return id
      }

      return runDownloadWithSlot({
        id,
        task: async (signal) => {
          if (!sdk) throw new Error('SDK not initialized')
          const sharedObject = await sdk.sharedObject(sharedUrl)
          const totalSize = Number(sharedObject.size())

          // Create a minimal file record for downloading
          // The actual metadata will be extracted from the downloaded file
          const file: FileRecord = {
            id,
            name: 'Shared File',
            type: 'application/octet-stream',
            kind: 'file',
            size: totalSize,
            hash: '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            localId: null,
            addedAt: Date.now(),
            trashedAt: null,
            deletedAt: null,
            objects: {},
          }

          await streamToCache({
            file,
            pinnedObject: sharedObject,
            totalSize,
            download: (writer) =>
              sdk.download(
                writer,
                sharedObject,
                {
                  maxInflight: DOWNLOAD_MAX_INFLIGHT,
                  offset: BigInt(0),
                  length: undefined,
                },
                { signal },
              ),
            onAfterClose: async (targetFile) => {
              await copyFileToFs(file, targetFile)
            },
            signal,
          })
          return id
        },
      })
    },
    [sdk],
  )
}

/**
 * Creates a Writer that writes to a file stream and tracks progress.
 */
function createFileWriter(params: {
  fileId: string
  writer: WritableStreamDefaultWriter<Uint8Array>
  totalSize?: number
}): Writer {
  const { fileId, writer, totalSize } = params
  let bytesWritten = 0
  let chunks = 0

  return {
    async write(data: ArrayBuffer): Promise<void> {
      const buf = new Uint8Array(data)
      bytesWritten += buf.byteLength
      chunks += 1
      await writer.write(buf)

      // Update progress
      if (typeof totalSize === 'number' && totalSize > 0) {
        updateDownloadProgress(fileId, Math.min(1, bytesWritten / totalSize))
      } else if (chunks % 5 === 0) {
        updateDownloadProgress(fileId, Math.min(0.99, (chunks % 20) / 20))
      }

      if (chunks % 10 === 0) {
        logger.debug('streamToCache', 'progress', { bytesWritten })
      }
    },
  }
}

async function streamToCache(params: {
  file: FileRecord
  pinnedObject: PinnedObjectInterface
  totalSize?: number
  download: (writer: Writer) => Promise<void>
  onAfterClose?: (targetFile: File) => Promise<void>
  signal: AbortSignal
}): Promise<void> {
  const { file, totalSize, download, onAfterClose, signal } = params
  const targetFile = await getOrCreateTempDownloadFile(file)
  logger.debug('streamToCache', 'write_start', { uri: targetFile.uri })

  const fileWriter = targetFile.writableStream().getWriter()

  try {
    // Check for abort before starting
    if (signal.aborted) {
      logger.debug('streamToCache', 'abort_before_start')
      await targetFile.delete()
      return
    }

    // Create a writer that writes to the file and tracks progress
    const writer = createFileWriter({
      fileId: file.id,
      writer: fileWriter,
      totalSize,
    })

    // Download writes chunks to our writer
    await download(writer)

    logger.debug('streamToCache', 'stream_ended')
  } finally {
    await fileWriter.close()
    logger.debug('streamToCache', 'writer_closed')
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
  sharedObject: PinnedObjectInterface,
  byteCount: number,
): Promise<Uint8Array> {
  if (!sdk) {
    throw new Error('SDK not initialized')
  }

  logger.debug('downloadFirstBytesFromShared', 'downloading', { byteCount })

  // Collect bytes into an array
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  const abortController = new AbortController()

  const writer: Writer = {
    async write(data: ArrayBuffer): Promise<void> {
      const buf = new Uint8Array(data)
      chunks.push(buf)
      totalBytes += buf.length

      // Abort once we have enough bytes
      if (totalBytes >= byteCount) {
        abortController.abort()
      }
    },
  }

  try {
    await sdk.download(
      writer,
      sharedObject,
      {
        maxInflight: DOWNLOAD_MAX_INFLIGHT,
        offset: BigInt(0),
        length: BigInt(byteCount),
      },
      { signal: abortController.signal },
    )
  } catch (e) {
    // Ignore abort errors - we abort intentionally when we have enough bytes
    if (e instanceof Error && e.name !== 'AbortError') {
      throw e
    }
  }

  // Combine chunks and take only the requested number of bytes
  const bytes = new Uint8Array(Math.min(totalBytes, byteCount))
  let offset = 0
  for (const chunk of chunks) {
    const toCopy = Math.min(chunk.length, byteCount - offset)
    bytes.set(chunk.slice(0, toCopy), offset)
    offset += toCopy
    if (offset >= byteCount) break
  }

  logger.debug('downloadFirstBytesFromShared', 'downloaded', {
    bytes: bytes.length,
  })
  return bytes
}
