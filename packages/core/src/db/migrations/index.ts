import type { Migration } from '../types'
import { migration_0001_init_schema } from './0001_init_schema'
import { migration_0003_logs_data_column } from './0003_logs_data_column'
import { migration_0004_hash_and_thumbs } from './0004_hash_and_thumbs'
import { migration_0006_add_tags_and_directories } from './0006_add_tags_and_directories'

export const coreMigrations: Migration[] = [
  migration_0001_init_schema,
  migration_0003_logs_data_column,
  migration_0004_hash_and_thumbs,
  migration_0006_add_tags_and_directories,
]

export function sortMigrations(migrations: Migration[]): Migration[] {
  return [...migrations].sort((a, b) => a.id.localeCompare(b.id))
}
