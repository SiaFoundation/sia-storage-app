import type { DatabaseAdapter } from '../../adapters/db'
import type { Migration } from '../types'

async function up(db: DatabaseAdapter): Promise<void> {
  await db.execAsync(`ALTER TABLE files ADD COLUMN lostReason TEXT;`)
}

export const migration_0002_add_lost_reason: Migration = {
  id: '0002_add_lost_reason',
  description: 'Add lostReason column to files table.',
  up,
}
