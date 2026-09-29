import type { DatabaseAdapter } from '../../adapters/db'
import { naturalSortKey } from '../../lib/naturalSortKey'
import { normalizeName } from '../../lib/names'
import { queryNameDirGroups, recalculateCurrentForGroups } from '../operations/files'
import type { Migration } from '../types'

/*
 * Rewrites every stored file name, folder path and tag name into Unicode NFC,
 * the form the AppService normalizes each name to before it stores or looks
 * one up. Rows written before it normalized names hold the form they arrived
 * in, and Finder hands names to the File Provider decomposed (e and a combining
 * accent), so a library touched from Finder holds decomposed names on every
 * device it synced to. An NFC lookup compares bytes with = or IN and misses
 * such a row, so a decomposed Finder folder lists as empty, and a subfolder
 * created in it, or a file sync-down files into it, lands in a second,
 * composed folder.
 *
 * Two rows that differ only in composition become one. Folders merge into
 * the row already at the composed path, or the oldest, and their files,
 * subfolders and imports follow. Tags merge the same way, keeping every
 * file's link. Then each version stack a renamed or moved file sits in has
 * its current row and stackId recalculated, so two stacks of one visible name
 * become one file.
 *
 * No updatedAt moves and no object is flagged for sync-up, because every
 * device runs this migration on its own rows. Stamped as an edit, the rename
 * would be uploaded by every device for every accented file, and each upload
 * would reach the other devices as a newer edit, rewriting rows they had
 * already composed themselves. The provider feed triggers still stamp each
 * rewritten row, so Finder relists what changed.
 *
 * SQLite cannot compose Unicode, so the GLOB filter returns only rows with
 * a character outside printable ASCII, and those are composed in JS. A
 * library of ASCII names costs one scan of each table and writes nothing.
 * NFC can map a non-ASCII name to an ASCII one (the Kelvin sign U+212A
 * composes to K), so a merge looks up the composed path or name directly
 * rather than trusting the non-ASCII rows to contain it.
 *
 * The recalculation is the one in operations/files.ts, so it must only read
 * columns that exist by this migration. The test beside this file runs it
 * against a database migrated up to here, and fails if the recalculation
 * reads a column a later migration adds.
 */

const NON_ASCII = `GLOB '*[^ -~]*'`

type Row = { id: string; value: string; createdAt: number }

/**
 * Candidate rows grouped by their composed value, keeping only groups where
 * something changes. Each group's first row is the one that survives a merge:
 * the row already holding the composed value, else the oldest.
 */
async function groupsToCompose<T extends Row>(
  rows: T[],
  readComposed: (value: string) => Promise<T | null>,
): Promise<Map<string, T[]>> {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const composed = normalizeName(row.value)
    const group = groups.get(composed)
    if (group) group.push(row)
    else groups.set(composed, [row])
  }
  for (const [composed, group] of groups) {
    if (group.length === 1 && group[0].value === composed) {
      groups.delete(composed)
      continue
    }
    if (!group.some((r) => r.value === composed)) {
      const holder = await readComposed(composed)
      if (holder) group.push(holder)
    }
    group.sort((a, b) => {
      if ((a.value === composed) !== (b.value === composed)) return a.value === composed ? -1 : 1
      return a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1)
    })
  }
  return groups
}

async function composeDirectories(db: DatabaseAdapter, touchedFileIds: Set<string>) {
  const rows = await db.getAllAsync<Row>(
    `SELECT id, path AS value, createdAt FROM directories WHERE path ${NON_ASCII}`,
  )
  const groups = await groupsToCompose(rows, (path) =>
    db.getFirstAsync<Row>(
      `SELECT id, path AS value, createdAt FROM directories WHERE path = ?`,
      path,
    ),
  )
  // Path order puts a parent before its descendants, and each folder is
  // renamed before anything moves into it, so a folder takes its feed stamp
  // before its contents do. The OS shell drops an item that pages in ahead of
  // a parent it has not met.
  for (const path of [...groups.keys()].sort()) {
    const [survivor, ...merged] = groups.get(path)!
    if (survivor.value !== path) {
      await db.runAsync(
        `UPDATE directories SET path = ?, nameSortKey = ? WHERE id = ?`,
        path,
        naturalSortKey(path),
        survivor.id,
      )
    }
    for (const row of merged) {
      const files = await db.getAllAsync<{ id: string }>(
        `SELECT id FROM files WHERE directoryId = ?`,
        row.id,
      )
      for (const f of files) touchedFileIds.add(f.id)
      await db.runAsync(
        `UPDATE files SET directoryId = ? WHERE directoryId = ?`,
        survivor.id,
        row.id,
      )
      await db.runAsync(
        `UPDATE directories SET parentId = ? WHERE parentId = ?`,
        survivor.id,
        row.id,
      )
      await db.runAsync(
        `UPDATE imports SET directoryId = ? WHERE directoryId = ?`,
        survivor.id,
        row.id,
      )
      await db.runAsync(
        `UPDATE import_files SET directoryId = ? WHERE directoryId = ?`,
        survivor.id,
        row.id,
      )
      await db.runAsync(`DELETE FROM directories WHERE id = ?`, row.id)
    }
  }
}

async function composeFileNames(db: DatabaseAdapter, touchedFileIds: Set<string>) {
  const rows = await db.getAllAsync<{ id: string; name: string }>(
    `SELECT id, name FROM files WHERE name ${NON_ASCII}`,
  )
  for (const row of rows) {
    const name = normalizeName(row.name)
    if (name === row.name) continue
    await db.runAsync(
      `UPDATE files SET name = ?, nameSortKey = ? WHERE id = ?`,
      name,
      naturalSortKey(name),
      row.id,
    )
    touchedFileIds.add(row.id)
  }
}

async function composeTags(db: DatabaseAdapter) {
  const rows = await db.getAllAsync<Row & { usedAt: number }>(
    `SELECT id, name AS value, createdAt, usedAt FROM tags WHERE name ${NON_ASCII}`,
  )
  const groups = await groupsToCompose(rows, (name) =>
    db.getFirstAsync<Row & { usedAt: number }>(
      `SELECT id, name AS value, createdAt, usedAt FROM tags WHERE name = ?`,
      name,
    ),
  )
  for (const [name, group] of groups) {
    const [survivor, ...merged] = group
    for (const row of merged) {
      // OR IGNORE because a file tagged with both forms already has the
      // survivor's (fileId, tagId) key.
      await db.runAsync(
        `INSERT OR IGNORE INTO file_tags (fileId, tagId)
         SELECT fileId, ? FROM file_tags WHERE tagId = ?`,
        survivor.id,
        row.id,
      )
      await db.runAsync(`DELETE FROM file_tags WHERE tagId = ?`, row.id)
      await db.runAsync(`DELETE FROM tags WHERE id = ?`, row.id)
    }
    await db.runAsync(
      `UPDATE tags SET name = ?, usedAt = ? WHERE id = ?`,
      name,
      Math.max(...group.map((r) => r.usedAt)),
      survivor.id,
    )
  }
}

async function composeImportNames(db: DatabaseAdapter) {
  const rows = await db.getAllAsync<{ id: string; name: string }>(
    `SELECT id, name FROM import_files WHERE name ${NON_ASCII}`,
  )
  for (const row of rows) {
    const name = normalizeName(row.name)
    if (name !== row.name) {
      await db.runAsync(`UPDATE import_files SET name = ? WHERE id = ?`, name, row.id)
    }
  }
}

async function up(db: DatabaseAdapter): Promise<void> {
  const touchedFileIds = new Set<string>()
  await composeDirectories(db, touchedFileIds)
  await composeFileNames(db, touchedFileIds)
  await composeTags(db)
  await composeImportNames(db)

  // Read after every rewrite, so each group is the stack a file sits in now.
  // A stack a file left is empty, since every row with that name or folder
  // was rewritten or moved with it.
  const ids = [...touchedFileIds]
  const groups: { name: string; directoryId: string | null }[] = []
  for (let i = 0; i < ids.length; i += 500) {
    groups.push(...(await queryNameDirGroups(db, ids.slice(i, i + 500))))
  }
  await recalculateCurrentForGroups(db, groups)
}

export const migration_20261007_120000_compose_stored_names: Migration = {
  id: '20261007_120000_compose_stored_names',
  description: 'Store every file name, folder path and tag name in Unicode NFC.',
  up,
}
