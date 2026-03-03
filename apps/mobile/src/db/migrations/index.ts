import { coreMigrations, sortMigrations } from '@siastorage/core/db/migrations'
import { migration_keychain_afterfirstunlock } from './keychain_afterfirstunlock'

export const migrations = sortMigrations([
  ...coreMigrations,
  migration_keychain_afterfirstunlock,
])
