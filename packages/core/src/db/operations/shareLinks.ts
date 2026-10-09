import type { DatabaseAdapter } from '../../adapters/db'
import type { ShareLinkFileState, ShareLinkMode } from '../../types/shareLinks'

export type ShareLinkRow = {
  publicKey: string
  /** The key's seed in hex. */
  seed: string
  indexerURL: string
  createdAt: number
  expiresAt: number | null
  mode: ShareLinkMode
}

export type ShareLinkFileRow = {
  publicKey: string
  fileId: string
  state: ShareLinkFileState
}

export type ShareLinkObjectRow = {
  publicKey: string
  objectId: string
  sharedUpdatedAt: number | null
}

export async function insertShareLink(db: DatabaseAdapter, link: ShareLinkRow): Promise<void> {
  await db.runAsync(
    `INSERT INTO share_links (publicKey, seed, indexerURL, createdAt, expiresAt, mode)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (publicKey) DO NOTHING`,
    link.publicKey,
    link.seed,
    link.indexerURL,
    link.createdAt,
    link.expiresAt,
    link.mode,
  )
}

/** Removes a link. Its files and objects rows go with it by ON DELETE CASCADE. */
export async function deleteShareLink(db: DatabaseAdapter, publicKey: string): Promise<void> {
  await db.runAsync('DELETE FROM share_links WHERE publicKey = ?', publicKey)
}

/** The links on one indexer, newest first. */
export async function queryShareLinks(
  db: DatabaseAdapter,
  indexerURL: string,
): Promise<ShareLinkRow[]> {
  return db.getAllAsync<ShareLinkRow>(
    `SELECT publicKey, seed, indexerURL, createdAt, expiresAt, mode FROM share_links
     WHERE indexerURL = ?
     ORDER BY createdAt DESC, publicKey`,
    indexerURL,
  )
}

export async function queryShareLink(
  db: DatabaseAdapter,
  publicKey: string,
): Promise<ShareLinkRow | null> {
  return db.getFirstAsync<ShareLinkRow>(
    'SELECT publicKey, seed, indexerURL, createdAt, expiresAt, mode FROM share_links WHERE publicKey = ?',
    publicKey,
  )
}

export async function insertShareLinkFile(
  db: DatabaseAdapter,
  publicKey: string,
  fileId: string,
  state: ShareLinkFileState,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO share_link_files (publicKey, fileId, state) VALUES (?, ?, ?)
     ON CONFLICT (publicKey, fileId) DO NOTHING`,
    publicKey,
    fileId,
    state,
  )
}

/** Moves a shared file to another of its version rows and sets its state. */
export async function updateShareLinkFile(
  db: DatabaseAdapter,
  publicKey: string,
  fileId: string,
  update: { fileId: string; state: ShareLinkFileState },
): Promise<void> {
  await db.runAsync(
    'UPDATE share_link_files SET fileId = ?, state = ? WHERE publicKey = ? AND fileId = ?',
    update.fileId,
    update.state,
    publicKey,
    fileId,
  )
}

export async function deleteShareLinkFile(
  db: DatabaseAdapter,
  publicKey: string,
  fileId: string,
): Promise<void> {
  await db.runAsync(
    'DELETE FROM share_link_files WHERE publicKey = ? AND fileId = ?',
    publicKey,
    fileId,
  )
}

export async function queryShareLinkFiles(
  db: DatabaseAdapter,
  publicKey: string,
): Promise<ShareLinkFileRow[]> {
  return db.getAllAsync<ShareLinkFileRow>(
    'SELECT publicKey, fileId, state FROM share_link_files WHERE publicKey = ? ORDER BY rowid',
    publicKey,
  )
}

export async function upsertShareLinkObject(
  db: DatabaseAdapter,
  publicKey: string,
  objectId: string,
  sharedUpdatedAt: number | null,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO share_link_objects (publicKey, objectId, sharedUpdatedAt) VALUES (?, ?, ?)
     ON CONFLICT (publicKey, objectId) DO UPDATE SET sharedUpdatedAt = excluded.sharedUpdatedAt`,
    publicKey,
    objectId,
    sharedUpdatedAt,
  )
}

export async function deleteShareLinkObject(
  db: DatabaseAdapter,
  publicKey: string,
  objectId: string,
): Promise<void> {
  await db.runAsync(
    'DELETE FROM share_link_objects WHERE publicKey = ? AND objectId = ?',
    publicKey,
    objectId,
  )
}

export async function queryShareLinkObjects(
  db: DatabaseAdapter,
  publicKey: string,
): Promise<ShareLinkObjectRow[]> {
  return db.getAllAsync<ShareLinkObjectRow>(
    'SELECT publicKey, objectId, sharedUpdatedAt FROM share_link_objects WHERE publicKey = ?',
    publicKey,
  )
}

/**
 * Sets a link's attached objects to exactly those the indexer last listed,
 * each with the updatedAt of the metadata it is attached with, or null where
 * that metadata names none. Returns whether any row changed.
 */
export async function replaceShareLinkObjects(
  db: DatabaseAdapter,
  publicKey: string,
  listed: Array<{ objectId: string; sharedUpdatedAt: number | null }>,
): Promise<boolean> {
  let changed = false
  await db.withTransactionAsync(async (tx) => {
    const known = new Map(
      (await queryShareLinkObjects(tx, publicKey)).map((o) => [o.objectId, o.sharedUpdatedAt]),
    )
    const listedIds = new Set(listed.map((o) => o.objectId))
    for (const objectId of known.keys()) {
      if (listedIds.has(objectId)) continue
      await deleteShareLinkObject(tx, publicKey, objectId)
      changed = true
    }
    for (const { objectId, sharedUpdatedAt } of listed) {
      if (known.get(objectId) === sharedUpdatedAt) continue
      await upsertShareLinkObject(tx, publicKey, objectId, sharedUpdatedAt)
      changed = true
    }
  })
  return changed
}

/** A shared file with the stack its row names. Name and directoryId are null once the row is gone. */
export type ShareLinkFileStack = ShareLinkFileRow & {
  name: string | null
  directoryId: string | null
  deletedAt: number | null
}

export async function queryShareLinkFileStacks(
  db: DatabaseAdapter,
  publicKey: string,
): Promise<ShareLinkFileStack[]> {
  return db.getAllAsync<ShareLinkFileStack>(
    `SELECT s.publicKey, s.fileId, s.state, f.name, f.directoryId, f.deletedAt
     FROM share_link_files s LEFT JOIN files f ON f.id = s.fileId
     WHERE s.publicKey = ?
     ORDER BY s.rowid`,
    publicKey,
  )
}

/**
 * An attached object with the file row it belongs to on this device. The file
 * fields are null for an object this device has not synced yet.
 */
export type ShareLinkObjectFile = ShareLinkObjectRow & {
  fileId: string | null
  name: string | null
  directoryId: string | null
  updatedAt: number | null
}

export async function queryShareLinkObjectFiles(
  db: DatabaseAdapter,
  publicKey: string,
  indexerURL: string,
): Promise<ShareLinkObjectFile[]> {
  return db.getAllAsync<ShareLinkObjectFile>(
    `SELECT s.publicKey, s.objectId, s.sharedUpdatedAt,
            f.id AS fileId, f.name, f.directoryId, f.updatedAt
     FROM share_link_objects s
     LEFT JOIN objects o ON o.id = s.objectId AND o.indexerURL = ?
     LEFT JOIN files f ON f.id = o.fileId
     WHERE s.publicKey = ?`,
    indexerURL,
    publicKey,
  )
}
