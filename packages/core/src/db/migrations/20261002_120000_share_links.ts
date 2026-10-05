import type { DatabaseAdapter } from '../../adapters/db'
import type { Migration } from '../types'

/*
 * Share links are sharing keys on the indexer, which also holds which objects
 * each key has attached. These tables are this device's view of that, plus
 * what the indexer cannot hold: files not uploaded yet, and files taken off a
 * link while trashed so a restore can put them back.
 *
 * share_links.mode is 'latest' or 'snapshot', as ShareLinkMode describes. A
 * device that did not make a link reads it from the key's description, which
 * the indexer keeps.
 *
 * share_link_files names each shared file by one of its version rows. A
 * latest link shows the stack that row belongs to at its current version, so
 * the row is moved to the current version each time one is attached. A
 * snapshot link shows the version the row names, which never moves.
 *
 * share_link_objects is the attached set as last seen. sharedUpdatedAt is
 * the files.updatedAt of the metadata attached, by this device or read back
 * from the attachment, so only newer metadata is attached again. It is null
 * where the attached metadata names none.
 */
async function up(db: DatabaseAdapter): Promise<void> {
  await db.execAsync(`
    CREATE TABLE share_links (
      publicKey TEXT PRIMARY KEY,
      indexerURL TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      expiresAt INTEGER,
      mode TEXT NOT NULL DEFAULT 'latest'
    );
    CREATE TABLE share_link_files (
      publicKey TEXT NOT NULL REFERENCES share_links(publicKey) ON DELETE CASCADE,
      fileId TEXT NOT NULL,
      state TEXT NOT NULL,
      PRIMARY KEY (publicKey, fileId)
    );
    CREATE TABLE share_link_objects (
      publicKey TEXT NOT NULL REFERENCES share_links(publicKey) ON DELETE CASCADE,
      objectId TEXT NOT NULL,
      sharedUpdatedAt INTEGER,
      PRIMARY KEY (publicKey, objectId)
    );
    CREATE INDEX idx_share_links_indexerURL_createdAt ON share_links (indexerURL, createdAt DESC, publicKey);
  `)
}

export const migration_20261002_120000_share_links: Migration = {
  id: '20261002_120000_share_links',
  description: 'Add share links, their files and their attached objects.',
  up,
}
