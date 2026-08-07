/*
 * What the library looks like to an OS storage-provider shell: one file per
 * name in each folder, and what changed since a point in the edit stream.
 *
 * A file here is its current version, which is the only thing a file browser
 * can show, so every version behind it is invisible through these queries.
 * Keeping that in one place is what lets `app.provider` deal in files without
 * knowing the library keeps a stack of them.
 *
 * The change feed's position is a cursor over `(updatedAt, id)`, not a
 * timestamp: a bulk write lands many rows in one millisecond, and a timestamp
 * alone cannot say where a cut page stopped. It reports three ways an item
 * stops being visible, trashed, tombstoned, and superseded; the last is found
 * through the file that replaced it, because demotion writes nothing to the
 * losing row and no read of the clock would ever find it.
 */
import type { DatabaseAdapter } from '../../adapters/db'
import type { FileRecordRow } from '../../types/files'
import { buildRecordFilter, UNFILED_DIRECTORY_ID } from './library'

/** Where a reader stopped. `id` breaks the tie between rows sharing a millisecond. */
export type ProviderChangeCursor = {
  updatedAt: number
  id: string
}

export type ProviderChangeRows = {
  changed: ProviderChangeRow[]
  /** Ids that were visible before and are not now: trashed, tombstoned or superseded. */
  removed: string[]
  /** Where the next read resumes. Unchanged from the input when nothing matched. */
  cursor: ProviderChangeCursor
  /** A full page came back, so more may be waiting past `cursor`. */
  hasMore: boolean
}

export type ProviderChangeRow = FileRecordRow & {
  fsExists: number
  directoryId: string | null
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
    `SELECT ${ROW_COLUMNS}, f.directoryId, (fs.fileId IS NOT NULL) AS fsExists
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

  // One pass over both: the page is a window on the edit clock, and whether a
  // row inside it is still visible is a property of the row.
  const rows = await db.getAllAsync<ProviderChangeRow & { visible: number }>(
    `SELECT ${ROW_COLUMNS}, f.directoryId,
            (fs.fileId IS NOT NULL) AS fsExists,
            (${VISIBLE}) AS visible
     FROM files f
     LEFT JOIN fs ON fs.fileId = f.id
     WHERE f.kind = 'file' ${scope}
       AND (f.updatedAt > ? OR (f.updatedAt = ? AND f.id > ?))
     ORDER BY f.updatedAt ASC, f.id ASC
     LIMIT ?`,
    ...scopeParams,
    since.updatedAt,
    since.updatedAt,
    since.id,
    limit,
  )

  const changed: ProviderChangeRow[] = []
  const removed: string[] = []
  for (const row of rows) {
    if (row.visible === 1) changed.push(row)
    else removed.push(row.id)
  }
  removed.push(...(await supersededIn(db, changed)))

  const last = rows[rows.length - 1]
  const hasMore = rows.length === limit
  return {
    changed,
    removed,
    // Mid-page the position is exact. At the end of the run it rewinds to the
    // start of the last millisecond: a row updated into that millisecond after
    // this read sorts by id, and half of them would land below an exact
    // position and never be read. Re-reporting a millisecond is the cheaper
    // mistake.
    cursor: last ? { updatedAt: last.updatedAt, id: hasMore ? last.id : '' } : since,
    hasMore,
  }
}

/**
 * The versions the files in a page replaced: whatever else lives under the
 * same name in the same folder is behind the current one, and behind means
 * gone as far as a file browser is concerned.
 */
async function supersededIn(db: DatabaseAdapter, current: ProviderChangeRow[]): Promise<string[]> {
  if (current.length === 0) return []
  const groups = current.map(() => '(f.name = ? AND f.directoryId IS ?)').join(' OR ')
  const params = current.flatMap((row) => [row.name, row.directoryId])
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT f.id FROM files f
     WHERE f.kind = 'file' AND NOT (${VISIBLE}) AND (${groups})`,
    ...params,
  )
  return rows.map((row) => row.id)
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
