/*
 * What the library looks like to an OS storage-provider shell: one file per
 * name in each folder, and what changed since a point in the feed sequence.
 *
 * A file here is its current version, which is the only thing a file browser
 * can show, so every version behind it is invisible through these queries.
 * Keeping that in one place is what lets `app.provider` deal in files without
 * knowing the library keeps a stack of them.
 *
 * The feed's position is a cursor over `(feedSeq, id)`. feedSeq is the
 * trigger-maintained apply-order sequence, never domain time: remote edits
 * carry another device's wall clock in `updatedAt`, and a cursor over that
 * could pass a row before it lands. Every way a row stops being visible,
 * trashed, tombstoned, superseded, moves the row's own feedSeq (the
 * `current` flip fires the trigger), so removals are rows in the window that
 * are no longer visible, and nothing needs to be found backwards. Rows from
 * before the feed migration sit at feedSeq 0 and page by id inside that
 * band.
 */
import type { DatabaseAdapter } from '../../adapters/db'
import type { FileRecordRow } from '../../types/files'
import { buildRecordFilter, UNFILED_DIRECTORY_ID } from './library'

/** Where a reader stopped. `id` breaks the tie between rows sharing a sequence. */
export type ProviderChangeCursor = {
  feedSeq: number
  id: string
}

export type ProviderChangeRows = {
  changed: ProviderChangeRow[]
  /** Rows in the window that are not visible now: trashed, tombstoned or superseded. */
  removed: { id: string; feedSeq: number }[]
  /** Where the next read resumes. Unchanged from the input when nothing matched. */
  cursor: ProviderChangeCursor
  /** A full page came back, so more may be waiting past `cursor`. */
  hasMore: boolean
}

export type ProviderChangeRow = FileRecordRow & {
  fsExists: number
  directoryId: string | null
  feedSeq: number
}

/**
 * One file by the identifier the shell holds, or null when that identifier no
 * longer names a file: trashed, tombstoned, or replaced by a newer version.
 */
export async function queryProviderItem(
  db: DatabaseAdapter,
  id: string,
): Promise<ProviderChangeRow | null> {
  const row = await db.getFirstAsync<ProviderChangeRow>(
    `SELECT ${ROW_COLUMNS}, f.directoryId, f.feedSeq, (fs.fileId IS NOT NULL) AS fsExists
     FROM files f
     LEFT JOIN fs ON fs.fileId = f.id
     WHERE f.id = ? AND ${VISIBLE}`,
    id,
  )
  return row ?? null
}

/**
 * Reads the next page of changes. `directoryId` scopes to one folder; `null`
 * reads across all of them, which is what the working set needs, because a
 * file moving between two folders is a change to neither one's contents alone.
 */
export async function queryProviderChanges(
  db: DatabaseAdapter,
  directoryId: string | null,
  since: ProviderChangeCursor,
  limit: number,
): Promise<ProviderChangeRows> {
  const scope =
    directoryId === null
      ? ''
      : directoryId === UNFILED_DIRECTORY_ID
        ? 'AND f.directoryId IS NULL'
        : 'AND f.directoryId = ?'
  const scopeParams =
    directoryId === null || directoryId === UNFILED_DIRECTORY_ID ? [] : [directoryId]

  // One pass over both: the page is a window on the feed, and whether a row
  // inside it is still visible is a property of the row.
  const rows = await db.getAllAsync<ProviderChangeRow & { visible: number }>(
    `SELECT ${ROW_COLUMNS}, f.directoryId, f.feedSeq,
            (fs.fileId IS NOT NULL) AS fsExists,
            (${VISIBLE}) AS visible
     FROM files f
     LEFT JOIN fs ON fs.fileId = f.id
     WHERE f.kind = 'file' ${scope}
       AND (f.feedSeq > ? OR (f.feedSeq = ? AND f.id > ?))
     ORDER BY f.feedSeq ASC, f.id ASC
     LIMIT ?`,
    ...scopeParams,
    since.feedSeq,
    since.feedSeq,
    since.id,
    limit,
  )

  const changed: ProviderChangeRow[] = []
  const removed: { id: string; feedSeq: number }[] = []
  for (const row of rows) {
    if (row.visible === 1) changed.push(row)
    else removed.push({ id: row.id, feedSeq: row.feedSeq })
  }

  const last = rows[rows.length - 1]
  const hasMore = rows.length === limit
  // The position is exact in both cases: a later transaction always takes a
  // larger sequence, so nothing can land at or below a position already read.
  return {
    changed,
    removed,
    cursor: last ? { feedSeq: last.feedSeq, id: last.id } : since,
    hasMore,
  }
}

/**
 * A ledger row: id left `parentId` at `feedSeq`, by moving or by its row
 * being destroyed. Never delivered as-is; the reader resolves the id's
 * current state, because "moved from A then deleted in B" must read as a
 * deletion in A's scope and only the live tables know.
 */
export type ProviderDepartureRow = {
  id: string
  kind: 'file' | 'dir'
  /** The parent's row id at departure; '' encodes root. */
  parentId: string
  reason: 'moved' | 'deleted'
  feedSeq: number
}

export type ProviderDirectoryChangeRow = {
  id: string
  path: string
  createdAt: number
  parentId: string | null
  feedSeq: number
}

/** Directory rows past the cursor, for the working set's folder deltas. */
export async function queryDirectoryChangesSince(
  db: DatabaseAdapter,
  since: ProviderChangeCursor,
  limit: number,
): Promise<ProviderDirectoryChangeRow[]> {
  return db.getAllAsync(
    `SELECT id, path, createdAt, parentId, feedSeq FROM directories
     WHERE feedSeq > ? OR (feedSeq = ? AND id > ?)
     ORDER BY feedSeq ASC, id ASC
     LIMIT ?`,
    since.feedSeq,
    since.feedSeq,
    since.id,
    limit,
  )
}

/** One folder's child directory rows past the cursor, for its scoped delta. */
export async function queryDirectoryChangesForParent(
  db: DatabaseAdapter,
  parentId: string | null,
  since: ProviderChangeCursor,
  limit: number,
): Promise<ProviderDirectoryChangeRow[]> {
  const cond = parentId === null ? 'parentId IS NULL' : 'parentId = ?'
  const params = parentId === null ? [] : [parentId]
  return db.getAllAsync(
    `SELECT id, path, createdAt, parentId, feedSeq FROM directories
     WHERE ${cond} AND (feedSeq > ? OR (feedSeq = ? AND id > ?))
     ORDER BY feedSeq ASC, id ASC
     LIMIT ?`,
    ...params,
    since.feedSeq,
    since.feedSeq,
    since.id,
    limit,
  )
}

/** Destructions past the cursor; the working set's removals. */
export async function queryDeletedDeparturesSince(
  db: DatabaseAdapter,
  since: ProviderChangeCursor,
  limit: number,
): Promise<ProviderDepartureRow[]> {
  return db.getAllAsync(
    `SELECT id, kind, parentId, reason, feedSeq FROM feed_departures
     WHERE reason = 'deleted' AND (feedSeq > ? OR (feedSeq = ? AND id > ?))
     ORDER BY feedSeq ASC, id ASC
     LIMIT ?`,
    since.feedSeq,
    since.feedSeq,
    since.id,
    limit,
  )
}

/** Departures from one folder past the cursor; '' is the root partition. */
export async function queryDeparturesForParent(
  db: DatabaseAdapter,
  parentId: string,
  since: ProviderChangeCursor,
  limit: number,
): Promise<ProviderDepartureRow[]> {
  return db.getAllAsync(
    `SELECT id, kind, parentId, reason, feedSeq FROM feed_departures
     WHERE parentId = ? AND (feedSeq > ? OR (feedSeq = ? AND id > ?))
     ORDER BY feedSeq ASC, id ASC
     LIMIT ?`,
    parentId,
    since.feedSeq,
    since.feedSeq,
    since.id,
    limit,
  )
}

/**
 * Current state for a page of departure ids, visibility included, so the
 * reader can tell a moved row (deliver its item) from a dead or invisible
 * one (deliver the deletion).
 */
export async function queryProviderRowsByIds(
  db: DatabaseAdapter,
  ids: string[],
): Promise<(ProviderChangeRow & { visible: number })[]> {
  if (ids.length === 0) return []
  const ph = ids.map(() => '?').join(',')
  return db.getAllAsync(
    `SELECT ${ROW_COLUMNS}, f.directoryId, f.feedSeq,
            (fs.fileId IS NOT NULL) AS fsExists,
            (${VISIBLE}) AS visible
     FROM files f
     LEFT JOIN fs ON fs.fileId = f.id
     WHERE f.id IN (${ph})`,
    ...ids,
  )
}

/**
 * One keyset page of a folder's visible files in name order, for the
 * per-folder listing; offset paging re-skips every prior row on each page,
 * which is quadratic across a big folder.
 */
export async function queryProviderFolderFiles(
  db: DatabaseAdapter,
  directoryId: string,
  after: { nameSortKey: string; id: string } | null,
  limit: number,
): Promise<(ProviderChangeRow & { nameSortKey: string })[]> {
  const scope = directoryId === UNFILED_DIRECTORY_ID ? 'f.directoryId IS NULL' : 'f.directoryId = ?'
  const scopeParams = directoryId === UNFILED_DIRECTORY_ID ? [] : [directoryId]
  const cursorCond =
    after === null ? '' : 'AND (f.nameSortKey > ? OR (f.nameSortKey = ? AND f.id > ?))'
  const cursorParams = after === null ? [] : [after.nameSortKey, after.nameSortKey, after.id]
  return db.getAllAsync(
    `SELECT ${ROW_COLUMNS}, f.directoryId, f.feedSeq, f.nameSortKey,
            (fs.fileId IS NOT NULL) AS fsExists
     FROM files f
     LEFT JOIN fs ON fs.fileId = f.id
     WHERE ${scope} AND ${VISIBLE} ${cursorCond}
     ORDER BY f.nameSortKey ASC, f.id ASC
     LIMIT ?`,
    ...scopeParams,
    ...cursorParams,
    limit,
  )
}

/**
 * The feed's epoch and high-water mark. The epoch is minted once per
 * database life; a listing captures the seq so its delta handover starts
 * where the listing started reading.
 */
export async function queryFeedMeta(
  db: DatabaseAdapter,
): Promise<{ seq: number; epoch: string; horizon: number }> {
  const row = await db.getFirstAsync<{ seq: number; epoch: string; horizon: number }>(
    'SELECT seq, epoch, horizon FROM feed_meta WHERE id = 1',
  )
  if (!row) throw new Error('feed_meta is missing; migrations have not run')
  return row
}

/**
 * Prunes ledger rows below a new horizon. Safe only because every poll,
 * including an empty one, advances its anchor to the high-water mark: an
 * anchor below the horizon means an enumerator that has not polled since,
 * and changes() answers it with one relist instead of silence.
 */
export async function pruneFeedDepartures(db: DatabaseAdapter, horizon: number): Promise<void> {
  await db.runAsync(`UPDATE feed_meta SET horizon = max(horizon, ?) WHERE id = 1`, horizon)
  await db.runAsync(
    `DELETE FROM feed_departures WHERE feedSeq < (SELECT horizon FROM feed_meta WHERE id = 1)`,
  )
}

/**
 * What the library counts as a visible record, from the one place that decides
 * it.
 */
const VISIBLE = buildRecordFilter('f')

const ROW_COLUMNS = [
  'id',
  'name',
  'size',
  'createdAt',
  'updatedAt',
  'type',
  'kind',
  'mediaAssetId',
  'hash',
  'addedAt',
  'thumbForId',
  'thumbSize',
  'trashedAt',
  'deletedAt',
]
  .map((column) => `f.${column}`)
  .join(', ')
