import type { FileEntry, FlushRecord } from '@siastorage/core/services/uploader'
import { useCallback } from 'react'
import { app, getUploadManager, internal } from '../stores/appService'

export { getUploadManager }
export type { FileEntry, FlushRecord }

export async function initializeUploader(): Promise<void> {
  const currentManager = getUploadManager()
  if (currentManager) {
    await currentManager.shutdown()
  }
  internal().initUploader()
}

export function useUploader() {
  return useCallback(async (files: Array<{ id: string; type: string; size: number }>) => {
    const entries: Array<{
      fileId: string
      fileUri: string
      size: number
    }> = []
    for (const file of files) {
      const fileUri = await app().fs.getFileUri(file)
      if (!fileUri) continue
      entries.push({ fileId: file.id, fileUri, size: file.size })
    }
    if (entries.length > 0) {
      await app().uploader.enqueueWithUri(entries)
    }
  }, [])
}

export function useReuploadFile() {
  return useCallback(async (fileId: string) => {
    await app().uploader.enqueueByIds([fileId])
  }, [])
}

export async function queueUploadForFileId(fileId: string): Promise<void> {
  try {
    await app().uploader.enqueueByIds([fileId])
  } catch {
    // SDK not connected — silently skip
  }
}
