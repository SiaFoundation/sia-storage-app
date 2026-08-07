/*
 * What the library looks like to an OS storage-provider shell: one file per
 * name in each folder.
 *
 * A file here is its current version, which is the only thing a file browser
 * can show, so every version behind it is invisible through these queries.
 * Keeping that in one place is what lets `app.provider` deal in files without
 * knowing the library keeps a stack of them.
 */
import type { DatabaseAdapter } from '../../adapters/db'
import type { FileRecordRow } from '../../types/files'
import { buildRecordFilter } from './library'

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
