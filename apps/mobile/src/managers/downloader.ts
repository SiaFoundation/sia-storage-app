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
