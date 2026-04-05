import { SlotPool } from '@siastorage/core/lib/slotPool'
import type { FileRecord } from '@siastorage/core/types'
import { logger } from '@siastorage/logger'
import { app } from '../stores/appService'
import { getThumbnailScanner } from './thumbnailScanner'

const THUMBNAIL_CONCURRENCY = 5

export function isFileBeingProcessed(fileId: string): boolean {
  return getThumbnailScanner().isFileBeingProcessed(fileId)
}

export function isFileInErrorCooldown(fileId: string): boolean {
  return getThumbnailScanner().isFileInErrorCooldown(fileId)
}

export async function generateThumbnailsForFile(fileRecord: FileRecord): Promise<void> {
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
  if (produced > 0) {
    await app().caches.library.invalidateAll()
    app().caches.libraryVersion.invalidate()
  }
}
