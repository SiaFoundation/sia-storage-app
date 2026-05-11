import type { Migration } from '../types'
import { migration_0001_init_schema } from './0001_init_schema'
import { migration_0002_object_needs_sync_up } from './0002_object_needs_sync_up'

export const coreMigrations: Migration[] = [
  migration_0001_init_schema,
  migration_0002_object_needs_sync_up,
]

export function sortMigrations(migrations: Migration[]): Migration[] {
  return [...migrations].sort((a, b) => a.id.localeCompare(b.id))
}
