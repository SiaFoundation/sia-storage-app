import * as SQLite from 'expo-sqlite'
import * as SecureStore from 'expo-secure-store'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { type Migration } from './types'
import { logger } from '../../lib/logger'

const MIGRATION_ID = '0005_migrate_settings_to_async'

// Migrates all settings from secure storage to async storage except 'recoveryPhrase'.
async function up(db: SQLite.SQLiteDatabase): Promise<void> {
  const keysToMigrate = [
    'indexerURL',
    'libraryViewMode',
    'maxUploads',
    'maxDownloads',
    'hasOnboarded',
    'showAdvanced',
    'autoScanUploads',
    'autoSyncDownEvents',
    'autoSyncPhotosArchive',
    'autoSyncNewPhotos',
    'photosArchiveCursor',
    'photosNewCursor',
    'fsEvictionLastRun',
    'fsOrphanLastRun',
    'syncDownCursor',
    'syncUpCursor',
    'enableSdkLogs',
  ]

  let migratedCount = 0
  let skippedCount = 0

  for (const key of keysToMigrate) {
    try {
      // Check if value exists in secure storage.
      const secureValue = await SecureStore.getItemAsync(key)

      if (secureValue !== null) {
        // Check if value already exists in async storage.
        const asyncValue = await AsyncStorage.getItem(key)

        // Only migrate if async storage doesn't have a value yet.
        if (asyncValue === null) {
          await AsyncStorage.setItem(key, secureValue)
          migratedCount++
          logger.log(
            `[db] migrated ${key} from secure storage to async storage`
          )
        } else {
          skippedCount++
        }
      } else {
        skippedCount++
      }
    } catch (error) {
      logger.log(`[db] failed to migrate ${key}:`, error)
      skippedCount++
    }
  }

  logger.log(
    '[db] settings migration complete',
    JSON.stringify({ migratedCount, skippedCount })
  )
}

export const migration_0005_migrate_settings_to_async: Migration = {
  id: MIGRATION_ID,
  description: 'Migrate settings from secure storage to async storage.',
  up,
}
