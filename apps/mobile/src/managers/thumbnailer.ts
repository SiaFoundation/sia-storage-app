import { SlotPool } from '@siastorage/core/lib/slotPool'
import { logger } from '@siastorage/logger'
import type { FileRecord } from '../stores/files'
import { getThumbnailScanner } from './thumbnailScanner'

// TODO: consider file-size-based concurrency (e.g., fewer slots for large images)
const THUMBNAIL_CONCURRENCY = 5

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
  const pool = new SlotPool(THUMBNAIL_CONCURRENCY)
  let produced = 0
  await Promise.all(
    files.map((file) =>
      pool.withSlot(async () => {
        try {
          await generateThumbnailsForFile(file)
          produced++
        } catch (error) {
          logger.error('generateThumbnails', 'generation_error', {
            fileId: file.id,
            error: error as Error,
          })
        }
      }),
    ),
  )
  return produced
}
