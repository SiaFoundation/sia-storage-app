import type { DatabaseAdapter } from '../../adapters/db'
import type { Migration } from '../types'

/*
 * A file put in the trash comes off every share link for good. The trash
 * removes its share_link_files rows in the transaction that trashes it, but
 * taking its objects off the indexer needs the network, so
 * share_link_objects.detaching marks each attached object of a trashed file
 * until the next share link pass detaches it. The mark keeps that pass
 * detaching the object even if the file is restored first, and keeps the
 * listing from putting the restored file back on the link.
 *
 * share_link_files rows currently sit in state 'trashed' for files taken off
 * a link while in the trash, waiting for a restore to put them back. Restoring
 * no longer does that, so those rows are deleted. A pass detaches anything
 * still attached for them, since their files are in the trash.
 */
async function up(db: DatabaseAdapter): Promise<void> {
  await db.execAsync(`
    ALTER TABLE share_link_objects ADD COLUMN detaching INTEGER NOT NULL DEFAULT 0;
    DELETE FROM share_link_files WHERE state = 'trashed';
  `)
}

export const migration_20261102_120000_share_link_detaching: Migration = {
  id: '20261102_120000_share_link_detaching',
  description:
    'Mark share link objects of trashed files for detaching, and drop trashed share link files.',
  up,
}
