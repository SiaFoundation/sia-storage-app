import type { DatabaseAdapter, SQLParam } from '../../adapters/db'

/*
 * Stamps for metadata edits that reach older versions of a file: a tag
 * change, a favorite, a folder rename or move. An edit has to move a row's
 * updatedAt forward, because sync is last-writer-wins per row on updatedAt,
 * and a stamp below the indexer's copy or another device's copy loses to it.
 * The same column also orders a file's versions: the newest live row by
 * (updatedAt, id) is the one the library shows, and a restore brings a
 * trashed file's versions back in that order. Stamping an older version
 * with the wall clock lifts it above the version that replaced it, and one
 * stamp shared by every version leaves the choice to the ids, on this device
 * and on every device the rows sync to.
 *
 * So each edited row moves up only as far as the room below the next newer
 * version allows, and a newer version is restamped only when there is no
 * room left below it. Restamping a newer version nobody edited would make
 * this device's copy of it win over an edit another device made to it in
 * the meantime, and that edit would be lost. As long as every device keeps
 * a file's versions in strictly increasing order, last-writer-wins keeps
 * them in order too, since each row ends at the highest stamp any device
 * gave it.
 */

/** The rows an edit touched, as a FROM clause over `files f` and its parameters. */
export type EditedRows = { from: string; params: SQLParam[] }

/** Rows by id. json_each drives the join, so each id is one primary-key search. */
export const editedIds = (ids: string[]): EditedRows => ({
  from: 'FROM json_each(?) j CROSS JOIN files f ON f.id = j.value',
  params: [JSON.stringify(ids)],
})

/** Rows carrying a tag, read through the tag index. */
export const editedByTag = (tagId: string): EditedRows => ({
  from: 'FROM file_tags t CROSS JOIN files f ON f.id = t.fileId WHERE t.tagId = ?',
  params: [tagId],
})

type Row = { id: string; updatedAt: number }
type Stamp = { id: string; u: number }

/*
 * A live file's versions share a name and folder. A trashed file's versions
 * share a name, the folder they left and their trashedAt, which is how a
 * restore groups them. The joins read each group through an index:
 * idx_files_version_group for live rows, idx_files_trashed_versions for
 * trashed ones.
 */
const LIVE = `f.kind = 'file' AND f.trashedAt IS NULL AND f.deletedAt IS NULL`
const TRASHED = `f.kind = 'file' AND f.trashedAt IS NOT NULL AND f.deletedAt IS NULL`

const LIVE_MEMBERS = `
  SELECT g.key AS k, f.id, f.updatedAt FROM json_each(?) g CROSS JOIN files f
    ON f.name = json_extract(g.value, '$[0]') AND f.directoryId IS json_extract(g.value, '$[1]')
  WHERE ${LIVE}
  ORDER BY g.key, f.updatedAt DESC, f.id DESC`

const TRASHED_MEMBERS = `
  SELECT g.key AS k, f.id, f.updatedAt FROM json_each(?) g CROSS JOIN files f
    ON f.trashedAt = json_extract(g.value, '$[2]') AND f.name = json_extract(g.value, '$[0]')
      AND coalesce(f.trashedFrom, '') = json_extract(g.value, '$[1]')
  WHERE ${TRASHED}
  ORDER BY g.key, f.updatedAt DESC, f.id DESC`

/**
 * Gives the edited rows of one group a newer updatedAt, and any newer rows
 * that have to move with them. `rows` is the whole group, newest first.
 *
 * Walking up from the oldest edited row, a run collects that row and each
 * newer row that has to move with it, which is an edited row or one whose
 * stamp is not above the stamp the row below it takes. `low` is the lowest
 * stamp a row of the run can take, one past both its own stamp and the
 * stamp of the row below it.
 * Under an unmoved newer row the run sits halfway into the room left below
 * it, so the next edit there also finds room. A run reaching the newest
 * version moves up to the wall clock, as a plain edit of that row would.
 *
 * The stamps follow from the rows and the clock alone, so two devices
 * editing the same version from the same state can give it the same stamp,
 * most often under an unmoved newer row, and also at the top when the newest
 * stamp is ahead of both clocks. Sync then keeps the copy pushed last on
 * every device, since sync-down takes the remote copy on a tie and sync-up
 * pushes the local one, so the devices agree and one of the two edits is
 * lost, the same outcome as when one edit is later than the other.
 */
function stampGroup(rows: Row[], edited: Set<string>, now: number, out: Stamp[]): void {
  let i = rows.length - 1
  while (i >= 0) {
    if (!edited.has(rows[i].id)) {
      i--
      continue
    }
    const run: Stamp[] = []
    let below = -Infinity
    let j = i
    for (;;) {
      const low = Math.max(rows[j].updatedAt, below) + 1
      run.push({ id: rows[j].id, u: low })
      below = low
      const newer = rows[j - 1]
      if (!newer || (!edited.has(newer.id) && newer.updatedAt > low)) break
      j--
    }
    const newer = rows[j - 1]
    const shift = newer ? Math.floor((newer.updatedAt - 1 - below) / 2) : Math.max(0, now - below)
    for (const s of run) out.push({ id: s.id, u: s.u + shift })
    i = j - 1
  }
}

/** Splits `rows` into groups by `k`, keeping their order. */
function byGroup(rows: (Row & { k: number })[]): Row[][] {
  const groups: Row[][] = []
  for (const r of rows) (groups[r.k] ??= []).push(r)
  return groups.filter(Boolean)
}

/**
 * Stamps the rows an edit touched with a newer updatedAt, keeping every
 * file's versions in order, and flags the objects of each stamped row so
 * sync-up pushes it. Tombstoned rows and thumbnails belong to no group and
 * take one past their own stamp or the wall clock, whichever is later.
 */
export async function stampEditedRows(db: DatabaseAdapter, source: EditedRows): Promise<void> {
  const now = Date.now()
  const touched = await db.getAllAsync<{
    id: string
    updatedAt: number
    kind: string
    name: string
    directoryId: string | null
    trashedAt: number | null
    deletedAt: number | null
    trashedFrom: string
  }>(
    `SELECT f.id, f.updatedAt, f.kind, f.name, f.directoryId, f.trashedAt, f.deletedAt,
       coalesce(f.trashedFrom, '') AS trashedFrom
     ${source.from}`,
    ...source.params,
  )
  if (touched.length === 0) return

  const edited = new Set<string>()
  const live = new Map<string, unknown[]>()
  const trashed = new Map<string, unknown[]>()
  const stamps: Stamp[] = []
  for (const r of touched) {
    if (edited.has(r.id)) continue
    edited.add(r.id)
    if (r.kind !== 'file' || r.deletedAt !== null) {
      stamps.push({ id: r.id, u: Math.max(now, r.updatedAt + 1) })
    } else if (r.trashedAt === null) {
      const key = [r.name, r.directoryId]
      live.set(JSON.stringify(key), key)
    } else {
      const key = [r.name, r.trashedFrom, r.trashedAt]
      trashed.set(JSON.stringify(key), key)
    }
  }
  for (const [sql, keys] of [
    [LIVE_MEMBERS, live],
    [TRASHED_MEMBERS, trashed],
  ] as const) {
    if (keys.size === 0) continue
    const members = await db.getAllAsync<Row & { k: number }>(
      sql,
      JSON.stringify([...keys.values()]),
    )
    for (const group of byGroup(members)) stampGroup(group, edited, now, stamps)
  }

  const json = JSON.stringify(stamps)
  await db.runAsync(
    `UPDATE files SET updatedAt = json_extract(j.value, '$.u')
     FROM json_each(?) j WHERE files.id = json_extract(j.value, '$.id')`,
    json,
  )
  await db.runAsync(
    `UPDATE objects SET needsSyncUp = 1
     WHERE fileId IN (SELECT json_extract(value, '$.id') FROM json_each(?))`,
    json,
  )
}
