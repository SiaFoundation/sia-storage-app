import { yieldToEventLoop } from '@siastorage/core/lib/yieldToEventLoop'
import { logger } from '@siastorage/logger'
import type { FileRecord } from '../stores/files'
import { getThumbnailScanner } from './thumbnailScanner'

export function isFileBeingProcessed(fileId: string): boolean {
  return getThumbnailScanner().isFileBeingProcessed(fileId)
}

export function isFileInErrorCooldown(fileId: string): boolean {
  return getThumbnailScanner().isFileInErrorCooldown(fileId)
}

export async function generateThumbnailsForFile(
  fileRecord: FileRecord,
): Promise<void> {
  return getThumbnailScanner().generateThumbnailsForFile(fileRecord)
}

export async function generateThumbnails(files: FileRecord[]) {
  for (const file of files) {
    try {
      await generateThumbnailsForFile(file)
      await yieldToEventLoop()
    } catch (error) {
      logger.error('generateThumbnails', 'generation_error', {
        fileId: file.id,
        error: error as Error,
      })
    }
  }
}
