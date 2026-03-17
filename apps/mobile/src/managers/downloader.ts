import type { PinnedObjectRef, SdkAdapter } from '@siastorage/core/adapters'
import { DOWNLOAD_MAX_INFLIGHT } from '@siastorage/core/config'
import { useSdk } from '@siastorage/core/stores'
import type { FileRecord } from '@siastorage/core/types'
import { logger } from '@siastorage/logger'
import { useCallback } from 'react'
import type { Writer } from 'react-native-sia'
import { getOneSealedObject } from '../lib/file'
import { streamToCache } from '../lib/streamToCache'
import { useToast } from '../lib/toastContext'
import { app, internal } from '../stores/appService'
import { copyFileToFs } from '../stores/fs'

type Downloads = ReturnType<typeof app>['downloads']

/** Non-hook version for programmatic downloads (e.g., bulk operations) */
export async function downloadFile(file: FileRecord): Promise<void> {
  await app().downloads.downloadFile(file.id)
}

export function useDownload(file?: FileRecord | null) {
  const toast = useToast()
  const { data: isConnected } = useSdk()
  return useCallback(() => {
    if (!file) return
    if (!isConnected) return
    const sealedObject = getOneSealedObject(file)
    if (!sealedObject) {
      toast.show('No slabs available for this file')
      return
    }
    downloadFile(file).catch((e) => {
      logger.error('download', 'failed', { id: file.id, error: e as Error })
    })
  }, [isConnected, file, toast])
}

export function useDownloadFromShareURL() {
  return useCallback(async (id: string, sharedUrl: string) => {
    const downloads: Downloads = app().downloads
    const sdk = internal().requireSdk()
    const sharedObject = await sdk.sharedObject(sharedUrl)
    const totalSize = Number(sharedObject.size())

    const file = {
      id,
      type: 'application/octet-stream',
    }

    downloads.register(id)
    const slotToken = await downloads.acquireSlot()
    try {
      downloads.update(id, { status: 'downloading' })
      await streamToCache({
        file,
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
            { signal: new AbortController().signal },
          ),
        onAfterClose: async (targetFile) => {
          await copyFileToFs(file, targetFile.uri)
        },
        onProgress: (progress) => {
          downloads.update(id, { progress: Math.min(1, progress) })
        },
      })
      downloads.remove(id)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      downloads.update(id, { status: 'error', error: message })
      throw e
    } finally {
      downloads.releaseSlot(slotToken)
    }
    return id
  }, [])
}

/**
 * Download only the first N bytes from a shared object for type detection.
 * Returns the bytes as a Uint8Array.
 */
export async function downloadFirstBytesFromShared(
  sdk: SdkAdapter | null | undefined,
  sharedObject: PinnedObjectRef,
  byteCount: number,
): Promise<Uint8Array> {
  if (!sdk) {
    throw new Error('SDK not initialized')
  }

  logger.debug('downloadFirstBytesFromShared', 'downloading', { byteCount })

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  const abortController = new AbortController()

  const writer: Writer = {
    async write(data: ArrayBuffer): Promise<void> {
      const buf = new Uint8Array(data)
      chunks.push(buf)
      totalBytes += buf.length

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
    if (e instanceof Error && e.name !== 'AbortError') {
      throw e
    }
  }

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
