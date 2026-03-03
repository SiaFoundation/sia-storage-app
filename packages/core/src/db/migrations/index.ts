import type { Migration } from '../types'
import { migration_0001_init_schema } from './0001_init_schema'

export const coreMigrations: Migration[] = [migration_0001_init_schema]

export function sortMigrations(migrations: Migration[]): Migration[] {
  return [...migrations].sort((a, b) => a.id.localeCompare(b.id))
}
