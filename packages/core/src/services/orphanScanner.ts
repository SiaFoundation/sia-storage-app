import { logger } from '@siastorage/logger'
import type { AppService } from '../app/service'
import { getMimeTypeFromExtension } from '../lib/fileTypes'
import { yieldToEventLoop } from '../lib/yieldToEventLoop'

const BATCH_SIZE = 50

export type OrphanScannerResult = {
  removed: number
}

function extractFileIdFromName(name: string): string | null {
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex === -1) return name || null
  return name.slice(0, dotIndex) || null
}

/**
 * Scans the local file system for files not indexed in the database and deletes them.
 * Files may be orphaned from a different account, previous app version, or interrupted operations.
 * Processes in batches, yielding to the event loop between each.
 *
 * Suspension signal policy: accepts AbortSignal. DB + disk write loop —
 * removes orphaned files and metadata in batches. Checks the signal at
 * the batch boundary and per-row so a mid-scan abort releases promptly
 * before the DB gate closes.
 */
export async function runOrphanScanner(
  app: AppService,
  onProgress?: (removed: number, total: number) => void,
  signal?: AbortSignal,
): Promise<OrphanScannerResult | undefined> {
  const files = await app.fs.listFiles()
  if (files.length === 0) return undefined

  let removed = 0

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    if (signal?.aborted) break
    const batch = files.slice(i, i + BATCH_SIZE)

    const entries = batch
      .map((name) => ({ name, fileId: extractFileIdFromName(name) }))
      .filter((e): e is { name: string; fileId: string } => e.fileId !== null)

    const orphanedIds = await app.fs.findOrphanedFileIds(entries.map((e) => e.fileId))

    for (const entry of entries) {
      if (signal?.aborted) break
      if (!orphanedIds.has(entry.fileId)) continue
      try {
        const type = getMimeTypeFromExtension(entry.name) ?? 'application/octet-stream'
        await app.fs.removeFile({ id: entry.fileId, type })
        removed++
      } catch (error) {
        logger.error('orphanScanner', 'delete_failed', {
          fileId: entry.fileId,
          error: error as Error,
        })
      }
    }

    if (orphanedIds.size > 0) {
      await app.fs.deleteMetaBatch([...orphanedIds])
    }

    onProgress?.(removed, files.length)

    await yieldToEventLoop()
  }

  logger.info('orphanScanner', 'summary', {
    removed,
    total: files.length,
    aborted: signal?.aborted ?? false,
  })
  return { removed }
}
