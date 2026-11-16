/*
 * What the mount holds: the files whose bytes the operating system keeps in
 * the folder a file manager shows, a File Provider domain on macOS or a Cloud
 * Files sync root on Windows.
 *
 * The cache (`fs`) has one row per version and holds whatever this app put
 * there. The mount has one row per file, keyed by the stack id the system
 * names it by, because the system keeps one version of a file at most. Each
 * row says which version that is, so "is this version on the device" can be
 * answered from either table.
 *
 * The system writes and removes these bytes on its own, so a row is a record
 * of what it was last seen holding. A read of the system's own list corrects
 * it. No query here is used to decide that bytes are safe to delete from the
 * network's point of view. That rests on the `objects` table alone.
 */
import type { DatabaseAdapter } from '../../adapters/db'
import * as sql from '../sql'
import { buildRecordFilter } from './library'
import { shownRowCondition } from './providerChanges'

export type MountCopy = {
  stackId: string
  /** The version the system holds. */
  fileId: string
  /** Bytes on disk: the version's size, or the ranges served so far. */
  bytes: number
  /** False while only ranges are held, or after a whole fetch the system has not listed yet. */
  whole: boolean
  usedAt: number
}

type MountCopyRow = Omit<MountCopy, 'whole'> & { whole: number }

function toCopy(row: MountCopyRow): MountCopy {
  return { ...row, whole: row.whole === 1 }
}

export async function readMountCopy(
  db: DatabaseAdapter,
  stackId: string,
): Promise<MountCopy | null> {
  const row = await db.getFirstAsync<MountCopyRow>(
    'SELECT stackId, fileId, bytes, whole, usedAt FROM mount_copies WHERE stackId = ?',
    stackId,
  )
  return row ? toCopy(row) : null
}

/** Records that the system holds `fileId` whole under `stackId`, replacing any row there. */
export async function upsertWholeMountCopy(
  db: DatabaseAdapter,
  copy: { stackId: string; fileId: string; bytes: number; usedAt: number },
): Promise<void> {
  await sql.insert(
    db,
    'mount_copies',
    {
      stackId: copy.stackId,
      fileId: copy.fileId,
      bytes: copy.bytes,
      whole: 1,
      usedAt: copy.usedAt,
    },
    { conflictClause: 'OR REPLACE' },
  )
}

/**
 * Records a range of `fileId` the system now holds. Ranges of the version
 * already recorded add up, capped at the file's size since they can repeat.
 * A row for another version is replaced, because the system keeps ranges of
 * one version only. A whole row for this version stays whole.
 *
 * Ranges never make a row whole, even once they add up to the file's size,
 * since repeated ranges can add up to it with part of the file still
 * missing. The system says when it holds the whole file, through its list
 * of changes.
 *
 * One statement, because the system fetches several ranges of a file at
 * once, and a read followed by a write would lose one of two concurrent
 * additions.
 */
export async function addMountRange(
  db: DatabaseAdapter,
  range: { stackId: string; fileId: string; fileSize: number; bytes: number; usedAt: number },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO mount_copies (stackId, fileId, bytes, whole, usedAt)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(stackId) DO UPDATE SET
       bytes = CASE
         WHEN mount_copies.fileId = excluded.fileId
           THEN MIN(?, mount_copies.bytes + ?)
         ELSE excluded.bytes
       END,
       whole = (mount_copies.fileId = excluded.fileId AND mount_copies.whole = 1),
       fileId = excluded.fileId,
       usedAt = excluded.usedAt`,
    range.stackId,
    range.fileId,
    Math.min(range.fileSize, range.bytes),
    range.usedAt,
    range.fileSize,
    range.bytes,
  )
}

/**
 * Deletes the rows for `stackIds` and returns the ones deleted. With
 * `usedBefore`, a row used at or after it stays: the system read that file
 * again after it was seen without it, so it may hold it once more.
 */
export async function deleteMountCopies(
  db: DatabaseAdapter,
  stackIds: string[],
  usedBefore?: number,
): Promise<MountCopy[]> {
  if (stackIds.length === 0) return []
  const before = usedBefore ?? Number.MAX_SAFE_INTEGER
  const ids = JSON.stringify(stackIds)
  let rows: MountCopyRow[] = []
  await sql.transaction(db, async (tx) => {
    rows = await tx.getAllAsync<MountCopyRow>(
      `SELECT m.stackId, m.fileId, m.bytes, m.whole, m.usedAt FROM json_each(?) j
       JOIN mount_copies m ON m.stackId = j.value
       WHERE m.usedAt < ?`,
      ids,
      before,
    )
    await tx.runAsync(
      `DELETE FROM mount_copies
       WHERE stackId IN (SELECT value FROM json_each(?)) AND usedAt < ?`,
      ids,
      before,
    )
  })
  return rows.map(toCopy)
}

export async function deleteAllMountCopies(db: DatabaseAdapter): Promise<void> {
  await db.runAsync('DELETE FROM mount_copies')
}

export async function touchMountCopies(
  db: DatabaseAdapter,
  stackIds: string[],
  usedAt: number,
): Promise<void> {
  await db.runAsync(
    'UPDATE mount_copies SET usedAt = ? WHERE stackId IN (SELECT value FROM json_each(?))',
    usedAt,
    JSON.stringify(stackIds),
  )
}

/**
 * Moves the row for the version `fileId` to the stack that version now
 * belongs to. A rename onto a name another file holds merges two stacks, and
 * the system is then told the file by the surviving stack's id.
 */
export async function rekeyMountCopy(
  db: DatabaseAdapter,
  fileId: string,
  stackId: string,
): Promise<void> {
  await db.runAsync(
    'UPDATE OR REPLACE mount_copies SET stackId = ? WHERE fileId = ? AND stackId != ?',
    stackId,
    fileId,
    stackId,
  )
}

/**
 * Bytes the mount holds of versions with no copy in the cache. A version in
 * both places, one waiting to upload, is counted by the cache's own total.
 */
export async function queryMountOnlyBytes(db: DatabaseAdapter): Promise<number> {
  const row = await db.getFirstAsync<{ total: number }>(
    `SELECT COALESCE(SUM(m.bytes), 0) AS total FROM mount_copies m
     WHERE NOT EXISTS (SELECT 1 FROM fs WHERE fs.fileId = m.fileId)`,
  )
  return row?.total ?? 0
}

/** Stack ids of the rows recorded as whole, for comparing with the system's full list. */
export async function queryWholeMountStackIds(db: DatabaseAdapter): Promise<string[]> {
  const rows = await db.getAllAsync<{ stackId: string }>(
    'SELECT stackId FROM mount_copies WHERE whole = 1',
  )
  return rows.map((r) => r.stackId)
}

/**
 * Records that the system holds each of `stackIds` whole, as the version the
 * file manager shows for it. A stack with no visible file is left out. A row
 * already there keeps its last use, and a new one gets `usedAt`. A whole row
 * for the shown version is left as it is.
 */
export async function markMountCopiesWhole(
  db: DatabaseAdapter,
  stackIds: string[],
  usedAt: number,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO mount_copies (stackId, fileId, bytes, whole, usedAt)
     SELECT f.stackId, f.id, f.size, 1, ? FROM json_each(?) j
     CROSS JOIN files f INDEXED BY idx_files_stackId ON f.stackId = j.value
     WHERE ${buildRecordFilter('f')} AND ${shownRowCondition('f')}
     ON CONFLICT(stackId) DO UPDATE SET
       fileId = excluded.fileId, bytes = excluded.bytes, whole = 1
     WHERE mount_copies.whole = 0 OR mount_copies.fileId != excluded.fileId`,
    usedAt,
    JSON.stringify(stackIds),
  )
}

/**
 * Rows that no longer describe anything the system holds: a file with no
 * visible version, which the system deletes its copy of, and ranges of a
 * version that is no longer the one shown, which the system discards when
 * the content version changes. A whole row for an older version stays until
 * the system fetches the new one, since those bytes are still on disk.
 */
export async function queryStaleMountStackIds(db: DatabaseAdapter): Promise<string[]> {
  const rows = await db.getAllAsync<{ stackId: string }>(
    `SELECT m.stackId FROM mount_copies m
     WHERE NOT EXISTS (
       SELECT 1 FROM files f WHERE f.stackId = m.stackId AND ${buildRecordFilter('f')}
     ) OR (
       m.whole = 0 AND m.fileId != (
         SELECT s.id FROM files s
         WHERE s.stackId = m.stackId AND ${buildRecordFilter('s')}
         ORDER BY s.updatedAt DESC, s.id DESC
         LIMIT 1
       )
     )`,
  )
  return rows.map((r) => r.stackId)
}

export type SecondCopy = { fileId: string; type: string; addedAt: number }

/**
 * Cache copies of versions that have an object on `indexerURL` and that the
 * mount holds whole, in id order after `after`: those of `fileIds`, or all of
 * them. Such a version is on the network and in the mount, so its cache copy
 * is a second copy.
 */
export async function querySecondCopies(
  db: DatabaseAdapter,
  indexerURL: string,
  opts: { fileIds?: string[]; after: string | null; limit: number },
): Promise<SecondCopy[]> {
  const named = opts.fileIds ? 'AND m.fileId IN (SELECT value FROM json_each(?))' : ''
  return db.getAllAsync<SecondCopy>(
    `SELECT f.id AS fileId, f.type, fs.addedAt FROM mount_copies m
     JOIN fs ON fs.fileId = m.fileId
     JOIN files f ON f.id = m.fileId
     WHERE m.whole = 1 AND m.fileId > ? ${named}
       AND EXISTS (SELECT 1 FROM objects o WHERE o.fileId = m.fileId AND o.indexerURL = ?)
     ORDER BY m.fileId ASC
     LIMIT ?`,
    opts.after ?? '',
    ...(opts.fileIds ? [JSON.stringify(opts.fileIds)] : []),
    indexerURL,
    opts.limit,
  )
}

/**
 * Files the mount holds whole whose shown version has no object on
 * `indexerURL` and no copy in the cache, oldest use first. The uploader reads
 * only the cache, so these cannot reach the indexer until the system hands
 * their bytes back. It happens after the indexer is changed.
 */
export async function queryStrandedInMount(
  db: DatabaseAdapter,
  indexerURL: string,
  limit: number,
): Promise<{ stackId: string; fileId: string }[]> {
  return db.getAllAsync<{ stackId: string; fileId: string }>(
    `SELECT m.stackId, m.fileId FROM mount_copies m
     JOIN files f ON f.id = m.fileId
     WHERE m.whole = 1 AND ${buildRecordFilter('f')} AND f.lostReason IS NULL
       AND ${shownRowCondition('f')}
       AND NOT EXISTS (SELECT 1 FROM fs WHERE fs.fileId = m.fileId)
       AND NOT EXISTS (SELECT 1 FROM objects o WHERE o.fileId = m.fileId AND o.indexerURL = ?)
     ORDER BY m.usedAt ASC, m.stackId ASC
     LIMIT ?`,
    indexerURL,
    limit,
  )
}
