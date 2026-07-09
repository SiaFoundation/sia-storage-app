import type { Migration } from '../types'
import { migration_0001_init_schema } from './0001_init_schema'
import { migration_0002_object_needs_sync_up } from './0002_object_needs_sync_up'
import { migration_0003_create_imports } from './0003_create_imports'

export const coreMigrations: Migration[] = [
  migration_0001_init_schema,
  migration_0002_object_needs_sync_up,
  migration_0003_create_imports,
]

export function sortMigrations(migrations: Migration[]): Migration[] {
  return [...migrations].sort((a, b) => a.id.localeCompare(b.id))
}
