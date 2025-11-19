import * as SQLite from 'expo-sqlite'
import { Directory, File, Paths } from 'expo-file-system'
import { type Migration, type MigrationProgressHandler } from './types'
import { logger } from '../../lib/logger'
import { fsStorageDirectory } from '../../stores/fs'

const MIGRATION_ID = '0004_add_fs_table'

// Metadata table that mirrors files on disk so we can track usage,
// limit the total size of local storage, and evict unused files.
async function up(
  db: SQLite.SQLiteDatabase,
  onProgress?: MigrationProgressHandler
): Promise<void> {
  try {
    await db.execAsync(
      `CREATE TABLE IF NOT EXISTS fs (
        fileId TEXT PRIMARY KEY,
        size INTEGER NOT NULL,
        addedAt INTEGER NOT NULL,
        usedAt INTEGER NOT NULL
      );`
    )

    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_fs_addedAt ON fs(addedAt);`
    )
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_fs_usedAt ON fs(usedAt);`
    )

    await migrateLegacyCacheFiles(db, onProgress)
  } catch (e) {
    logger.log('[db] error running migration 0004_add_fs_table', e)
    throw e
  }
}

function parseCacheFileName(name: string): {
  fileId: string | null
  isTemporary: boolean
} {
  const uploadTmpSuffix = '.upload.tmp'
  if (name.endsWith(uploadTmpSuffix)) {
    return {
      fileId: name.slice(0, -uploadTmpSuffix.length),
      isTemporary: true,
    }
  }
  const tmpSuffix = '.tmp'
  if (name.endsWith(tmpSuffix)) {
    return {
      fileId: name.slice(0, -tmpSuffix.length),
      isTemporary: true,
    }
  }
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex === -1) {
    return { fileId: name, isTemporary: false }
  }
  return {
    fileId: name.slice(0, dotIndex),
    isTemporary: false,
  }
}

/**
 * Migrates legacy cache files to the new file system.
 * - Directory(Paths.cache, 'files-cache') -> fsStorageDirectory.
 * - Files with names ending in '.upload.tmp' or '.tmp' are ignored.
 */
async function migrateLegacyCacheFiles(
  db: SQLite.SQLiteDatabase,
  onProgress?: MigrationProgressHandler
): Promise<void> {
  // Report progress to the user.
  const progress = (processed: number, total: number) =>
    onProgress?.({
      id: MIGRATION_ID,
      message: `Moving local files to new directory (${processed}/${total})`,
    })

  const legacyDir = new Directory(Paths.cache, 'files-cache')
  const legacyInfo = legacyDir.info()
  if (!legacyInfo.exists) {
    return
  }

  const fsDirectory = fsStorageDirectory.info()
  if (!fsDirectory.exists) {
    fsStorageDirectory.create({ intermediates: true })
  }

  const fileRows = await db.getAllAsync<{ id: string }>('SELECT id FROM files')
  const knownFileIds = new Set(fileRows.map((row) => row.id))

  let migratedCount = 0
  let skippedCount = 0

  const entries = legacyDir.list()
  const total = entries.length
  progress(0, total)
  for (const entry of entries) {
    if (!(entry instanceof File)) {
      continue
    }

    const destination = new File(fsStorageDirectory, entry.name)
    try {
      const destinationInfo = destination.info()
      if (destinationInfo.exists) {
        destination.delete()
      }
      entry.copy(destination)

      const { fileId, isTemporary } = parseCacheFileName(entry.name)
      const info = destination.info()
      const size = info.size ?? 0

      if (fileId && !isTemporary && knownFileIds.has(fileId)) {
        // Insert metadata into new table.
        await db.runAsync(
          `INSERT OR REPLACE INTO fs (fileId, size, addedAt, usedAt) VALUES (?, ?, ?, ?)`,
          fileId,
          size,
          Date.now(),
          Date.now()
        )
        migratedCount += 1
      } else {
        // Skip tmp and orphaned files.
        skippedCount += 1
      }

      const processed = migratedCount + skippedCount
      progress(processed, total)

      // Delete the copy from the old cache directory.
      entry.delete()
    } catch (error) {
      skippedCount += 1
      logger.log('[db] failed to migrate legacy cache file', entry.uri, error)
    }
  }

  logger.log(
    '[db] legacy cache migration complete',
    JSON.stringify({ migratedCount, skippedCount })
  )

  // Attempt to clean up the old cache directory if it is empty.
  try {
    const remaining = legacyDir.list()
    if (remaining.length === 0) {
      legacyDir.delete()
    }
  } catch {}
}

export const migration_0004_add_fs_table: Migration = {
  id: '0004_add_fs_table',
  description: 'Add table tracking local file system.',
  up,
}
