import { createBetterSqlite3Database } from '@siastorage/node-adapters/database'
import { runMigrations } from '..'
import { coreMigrations, sortMigrations } from '.'
import { migration_20261029_120000_trash_remembers_folder } from './20261029_120000_trash_remembers_folder'

/**
 * A library as the trash left it before this migration: trashed files still
 * in their folders, which kept folders holding nothing else in the library.
 */
async function libraryBefore() {
  const db = createBetterSqlite3Database()
  await runMigrations(
    db,
    sortMigrations(coreMigrations).filter(
      (m) => m.id !== migration_20261029_120000_trash_remembers_folder.id,
    ),
  )
  const folder = (id: string, path: string, parentId: string | null = null) =>
    db.runAsync(
      `INSERT INTO directories (id, path, createdAt, nameSortKey, parentId) VALUES (?, ?, 1, ?, ?)`,
      id,
      path,
      path,
      parentId,
    )
  const file = (
    id: string,
    directoryId: string | null,
    state: { trashedAt?: number; deletedAt?: number } = {},
  ) =>
    db.runAsync(
      `INSERT INTO files (id, name, size, type, kind, createdAt, updatedAt, addedAt, hash, directoryId, stackId, trashedAt, deletedAt)
       VALUES (?, ?, 1, 'text/plain', 'file', 1, 7, 1, 'sha256:h', ?, ?, ?, ?)`,
      id,
      `${id}.txt`,
      directoryId,
      id,
      state.trashedAt ?? null,
      state.deletedAt ?? null,
    )

  await folder('trips', 'Trips')
  await file('kept', 'trips')
  await file('inTrips', 'trips', { trashedAt: 5 })

  await folder('ghost', 'Ghost')
  await folder('ghostSub', 'Ghost/sub', 'ghost')
  await file('inGhost', 'ghost', { trashedAt: 5 })
  await file('inGhostSub', 'ghostSub', { trashedAt: 5 })

  await folder('empty', 'Empty')

  await folder('importing', 'Importing')
  await file('inImporting', 'importing', { trashedAt: 5 })
  await db.runAsync(
    `INSERT INTO imports (id, source, directoryId, startedAt, updatedAt) VALUES ('imp', 'picker', 'importing', 1, 1)`,
  )
  await db.runAsync(
    `INSERT INTO import_files (id, importId, state, name, type, createdAt, updatedAt, addedAt, directoryId, sourceKind)
     VALUES ('pending', 'imp', 'pending', 'p.txt', 'text/plain', 1, 1, 1, 'importing', 'path')`,
  )

  // A photo library scan between pages: unsealed, with no file pending.
  await folder('scanning', 'Scanning')
  await file('inScanning', 'scanning', { trashedAt: 5 })
  await db.runAsync(
    `INSERT INTO imports (id, source, directoryId, sealed, startedAt, updatedAt) VALUES ('scan', 'library-scan', 'scanning', 0, 1, 1)`,
  )

  await folder('gone', 'Gone')
  await file('deletedForGood', 'gone', { trashedAt: 5, deletedAt: 6 })

  await file('atRoot', null, { trashedAt: 5 })
  return db
}

async function rows(db: Awaited<ReturnType<typeof libraryBefore>>) {
  return db.getAllAsync<{
    id: string
    directoryId: string | null
    trashedFrom: string | null
    updatedAt: number
  }>('SELECT id, directoryId, trashedFrom, updatedAt FROM files ORDER BY id')
}

it('moves each trashed file out of its folder, remembering the folder by path', async () => {
  const db = await libraryBefore()

  await migration_20261029_120000_trash_remembers_folder.up(db)

  expect(await rows(db)).toEqual([
    { id: 'atRoot', directoryId: null, trashedFrom: '', updatedAt: 7 },
    { id: 'deletedForGood', directoryId: 'gone', trashedFrom: null, updatedAt: 7 },
    { id: 'inGhost', directoryId: null, trashedFrom: 'Ghost', updatedAt: 7 },
    { id: 'inGhostSub', directoryId: null, trashedFrom: 'Ghost/sub', updatedAt: 7 },
    { id: 'inImporting', directoryId: null, trashedFrom: 'Importing', updatedAt: 7 },
    { id: 'inScanning', directoryId: null, trashedFrom: 'Scanning', updatedAt: 7 },
    { id: 'inTrips', directoryId: null, trashedFrom: 'Trips', updatedAt: 7 },
    { id: 'kept', directoryId: 'trips', trashedFrom: null, updatedAt: 7 },
  ])
})

it('deletes the folders only trashed files kept, up the tree, and keeps every other folder', async () => {
  const db = await libraryBefore()

  await migration_20261029_120000_trash_remembers_folder.up(db)

  const folders = await db.getAllAsync<{ path: string }>(
    'SELECT path FROM directories ORDER BY path',
  )
  // Gone holds only a file deleted for good, which the migration does not
  // touch, so the folder stays as it was.
  expect(folders.map((f) => f.path)).toEqual(['Empty', 'Gone', 'Importing', 'Scanning', 'Trips'])
})

it('checks more folders than SQLite binds in one statement, and keeps the parent until its last subfolder goes', async () => {
  const db = await libraryBefore()
  // SQLITE_MAX_VARIABLE_NUMBER is 32766, and one id is bound per folder.
  const FOLDERS = 33_000
  await db.runAsync(
    `INSERT INTO directories (id, path, createdAt, nameSortKey) VALUES ('many', 'Many', 1, 'Many')`,
  )
  await db.runAsync(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
     INSERT INTO directories (id, path, createdAt, nameSortKey, parentId)
     SELECT 'd' || i, 'Many/' || i, 1, i, 'many' FROM n`,
    FOLDERS,
  )
  await db.runAsync(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
     INSERT INTO files (id, name, size, type, kind, createdAt, updatedAt, addedAt, hash, directoryId, stackId, trashedAt)
     SELECT 'm' || i, 'm.txt', 1, 'text/plain', 'file', 1, 7, 1, 'sha256:h', 'd' || i, 'm' || i, 5 FROM n`,
    FOLDERS,
  )

  await migration_20261029_120000_trash_remembers_folder.up(db)

  const left = await db.getFirstAsync<{ n: number }>(
    `SELECT count(*) AS n FROM directories WHERE path = 'Many' OR path LIKE 'Many/%'`,
  )
  expect(left?.n).toBe(0)
}, 120_000)
