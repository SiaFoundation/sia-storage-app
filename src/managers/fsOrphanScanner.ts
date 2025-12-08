import { FS_ORPHAN_FREQUENCY } from '../config'
import { db } from '../db'
import { serviceLog } from '../lib/logger'
import { createServiceInterval } from '../lib/serviceInterval'
import {
  deleteFsFileMetadata,
  fsTriggerRefresh,
  listFilesInFsStorageDirectory,
} from '../stores/fs'
import {
  getAsyncStorageNumber,
  setAsyncStorageNumber,
} from '../stores/asyncStore'

function extractFileIdFromName(name: string): string | null {
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex === -1) return name || null
  return name.slice(0, dotIndex) || null
}

/**
 * fsOrphanScanner scans the file system for files that are not indexed in the database.
 * - If a file is not indexed, it is deleted from the file system.
 * Files may be orphaned if they are from a different account, previous version of app,
 * left after an error, or other edge cases.
 */
export async function runFsOrphanScanner(): Promise<
  { removed: number } | undefined
> {
  const lastRun = await getFsOrphanLastRun()
  if (Date.now() - lastRun < FS_ORPHAN_FREQUENCY) {
    return
  }

  try {
    const files = listFilesInFsStorageDirectory()
    if (files.length === 0) return

    let removed = 0
    for (const file of files) {
      const fileId = extractFileIdFromName(file.name)
      if (!fileId) continue

      const orphaned = await isFsFileOrphaned(fileId)
      if (!orphaned) continue

      try {
        file.delete()
        removed += 1
        await deleteFsFileMetadata(fileId)
        await fsTriggerRefresh(fileId)
        serviceLog(
          `[fsOrphanScanner] removed unindexed file fileId=${fileId} uri=${file.uri}`
        )
      } catch (error) {
        serviceLog(
          `[fsOrphanScanner] failed to delete file fileId=${fileId} uri=${file.uri} error=${error}`
        )
      }
    }

    if (removed > 0) {
      serviceLog(`[fsOrphanScanner] summary removed=${removed}`)
    }
    return { removed }
  } catch (error) {
    serviceLog('[fsOrphanScanner] error during scan', error)
  } finally {
    await setFsOrphanLastRun()
  }
}

/**
 * isFsFileOrphaned checks if an fs file is orphaned:
 * - no longer represented in the fs metadata table, or
 * - still in the fs metadata table but missing from the files table.
 */
export async function isFsFileOrphaned(fileId: string): Promise<boolean> {
  const row = await db().getFirstAsync<{ hasFs: number; hasFile: number }>(
    `SELECT
        EXISTS(SELECT 1 FROM fs WHERE fileId = ?) AS hasFs,
        EXISTS(SELECT 1 FROM files WHERE id = ?) AS hasFile`,
    fileId,
    fileId
  )
  return !(row?.hasFs === 1 && row?.hasFile === 1)
}

export const initFsOrphanScanner = createServiceInterval({
  name: 'fsOrphanScanner',
  worker: async () => {
    await runFsOrphanScanner()
  },
  getState: async () => true,
  interval: 30_000,
})

export async function setFsOrphanLastRun(): Promise<void> {
  await setAsyncStorageNumber('fsOrphanLastRun', Date.now())
}

export async function getFsOrphanLastRun(): Promise<number> {
  return await getAsyncStorageNumber('fsOrphanLastRun', 0)
}
