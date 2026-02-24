import { coreMigrations, sortMigrations } from '@siastorage/core/db/migrations'
import { migration_0002_keychain_accessibility } from './0002_keychain_accessibility'
import { migration_0005_reset_sync_up_cursor } from './0005_reset_sync_up_cursor'

export const migrations = sortMigrations([
  ...coreMigrations,
  migration_0002_keychain_accessibility,
  migration_0005_reset_sync_up_cursor,
])
