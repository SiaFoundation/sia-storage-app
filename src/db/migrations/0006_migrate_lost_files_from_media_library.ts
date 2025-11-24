import * as SQLite from 'expo-sqlite'
import { File } from 'expo-file-system'
import { type Migration, type MigrationProgressHandler } from './types'
import { logger } from '../../lib/logger'
import { getMediaLibraryUri } from '../../lib/mediaLibrary'
import { copyFileToFs } from '../../stores/fs'

const MIGRATION_ID = '0006_migrate_lost_files_from_media_library'

type LostFileRow = {
  id: string
  localId: string
  type: string
}

/**
 * We no longer rely on MediaLibrary URIs.
 * Goes through files that don't exist in the fs or objects tables but have a localId,
 * and tries to copy them from the media library to the file system.
 */
async function up(
  db: SQLite.SQLiteDatabase,
  onProgress?: MigrationProgressHandler
): Promise<void> {
  try {
    // Find all files that don't exist in fs or objects table but have a localId.
    const lostFiles = await db.getAllAsync<LostFileRow>(
      `SELECT f.id, f.localId, f.type
       FROM files f
       WHERE f.localId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM fs fs WHERE fs.fileId = f.id)
       AND NOT EXISTS (SELECT 1 FROM objects o WHERE o.fileId = f.id)`
    )

    if (lostFiles.length === 0) {
      logger.log('[db] no lost files with localId to migrate')
      return
    }

    logger.log(
      `[db] found ${lostFiles.length} lost files with localId to migrate`
    )

    let migratedCount = 0
    let skippedCount = 0

    const progress = (processed: number, total: number) =>
      onProgress?.({
        id: MIGRATION_ID,
        message: `Copying files from media library (${processed}/${total})`,
      })

    progress(0, lostFiles.length)

    for (const file of lostFiles) {
      try {
        // Try to get the URI from media library.
        const mediaUri = await getMediaLibraryUri(file.localId)
        if (!mediaUri) {
          logger.log(
            `[db] failed to get media library URI for file ${file.id}, localId: ${file.localId}`
          )
          skippedCount++
          progress(migratedCount + skippedCount, lostFiles.length)
          continue
        }

        // Copy the file to the file system.
        await copyFileToFs(
          {
            id: file.id,
            type: file.type,
          },
          new File(mediaUri)
        )

        migratedCount++
        logger.log(
          `[db] migrated file ${file.id} from media library to file system`
        )
        progress(migratedCount + skippedCount, lostFiles.length)
      } catch (error) {
        logger.log(
          `[db] failed to migrate file ${file.id} from media library:`,
          error
        )
        skippedCount++
        progress(migratedCount + skippedCount, lostFiles.length)
      }
    }

    logger.log(
      '[db] lost files migration complete',
      JSON.stringify({ migratedCount, skippedCount, total: lostFiles.length })
    )
  } catch (e) {
    logger.log(
      '[db] error running migration 0006_migrate_lost_files_from_media_library',
      e
    )
    throw e
  }
}

export const migration_0006_migrate_lost_files_from_media_library: Migration = {
  id: MIGRATION_ID,
  description: 'Migrate lost files from media library to file system.',
  up,
}
