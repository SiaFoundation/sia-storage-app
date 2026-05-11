import type { DatabaseAdapter } from '../../adapters/db'
import type { Migration } from '../types'

async function up(db: DatabaseAdapter): Promise<void> {
  await db.execAsync(`ALTER TABLE objects ADD COLUMN needsSyncUp INTEGER NOT NULL DEFAULT 0;`)
  // Flag every existing object once so the first post-upgrade sync-up pass
  // reconciles it (a no-diff pass clears it). Never-uploaded files have no object
  // row, so they are excluded.
  await db.execAsync(`UPDATE objects SET needsSyncUp = 1;`)
  // Partial index over the dirty set, covering the sync-up batch query's
  // `indexerURL = ? AND needsSyncUp = 1 ORDER BY id`.
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_objects_needs_sync_up
     ON objects(indexerURL, id)
     WHERE needsSyncUp = 1;`,
  )
}

export const migration_0002_object_needs_sync_up: Migration = {
  id: '0002_object_needs_sync_up',
  description: 'Add a per-object needsSyncUp dirty flag for sync-up.',
  up,
}
