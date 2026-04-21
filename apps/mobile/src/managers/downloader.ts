import type { PinnedObjectRef, SdkAdapter } from '@siastorage/core/adapters'
import { DOWNLOAD_MAX_INFLIGHT } from '@siastorage/core/config'
import { useSdk } from '@siastorage/core/stores'
import type { FileRecord } from '@siastorage/core/types'
import { logger } from '@siastorage/logger'
import { useCallback } from 'react'
import { getOneObject } from '../lib/file'
import { useToast } from '../lib/toastContext'
import { app } from '../stores/appService'

/** Non-hook version for programmatic downloads (e.g., bulk operations) */
export async function downloadFile(file: FileRecord, priority?: number): Promise<void> {
  await app().downloads.downloadFile(file.id, priority)
}

export function useDownload(file?: FileRecord | null, priority?: number) {
  const toast = useToast()
  const { data: isConnected } = useSdk()
  return useCallback(() => {
    if (!file) return
    if (!isConnected) return
    const obj = getOneObject(file)
    if (!obj) {
      toast.show('No slabs available for this file')
      return
    }
    downloadFile(file, priority).catch((e) => {
      logger.error('download', 'failed', { id: file.id, error: e as Error })
    })
  }, [isConnected, file, toast, priority])
}

export function useDownloadFromShareURL() {
  return useCallback(async (id: string, sharedUrl: string) => {
    await app().downloads.downloadFromShareUrl(id, sharedUrl)
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

  const dl = await sdk.download(sharedObject, {
    maxInflight: DOWNLOAD_MAX_INFLIGHT,
    offset: BigInt(0),
    length: BigInt(byteCount),
  })
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (totalBytes < byteCount) {
      const chunk = await dl.read()
      if (chunk.byteLength === 0) break
      const buf = new Uint8Array(chunk)
      chunks.push(buf)
      totalBytes += buf.length
    }
  } finally {
    await dl.cancel().catch(() => {})
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
