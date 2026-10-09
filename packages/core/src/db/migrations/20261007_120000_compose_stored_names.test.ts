import { createBetterSqlite3Database } from '@siastorage/node-adapters/database'
import type { DatabaseAdapter } from '../../adapters/db'
import { naturalSortKey } from '../../lib/naturalSortKey'
import { runMigrations } from '..'
import { recalculateCurrentForGroup } from '../operations/files'
import { coreMigrations, sortMigrations } from '.'
import { migration_20261007_120000_compose_stored_names as migration } from './20261007_120000_compose_stored_names'

const nfd = (s: string) => s.normalize('NFD')

let db: DatabaseAdapter

beforeEach(async () => {
  db = createBetterSqlite3Database()
  await runMigrations(
    db,
    sortMigrations(coreMigrations).filter((m) => m.id < migration.id),
  )
})

afterEach(() => db.close?.())

async function runMigration() {
  await db.withTransactionAsync((tx) => migration.up(tx))
}

async function insertDir(id: string, path: string, parentId: string | null = null, createdAt = 1) {
  await db.runAsync(
    `INSERT INTO directories (id, path, createdAt, nameSortKey, parentId) VALUES (?, ?, ?, ?, ?)`,
    id,
    path,
    createdAt,
    naturalSortKey(path),
    parentId,
  )
}

async function insertFile(
  id: string,
  name: string,
  directoryId: string | null,
  opts: { updatedAt?: number; current?: number } = {},
) {
  await db.runAsync(
    `INSERT INTO files (id, name, nameSortKey, size, type, kind, createdAt, updatedAt, addedAt,
                        hash, directoryId, current)
     VALUES (?, ?, ?, 1, 'image/jpeg', 'file', 1, ?, 1, ?, ?, ?)`,
    id,
    name,
    naturalSortKey(name),
    opts.updatedAt ?? 1,
    `sha256:${id}`,
    directoryId,
    opts.current ?? 1,
  )
}

async function insertTag(id: string, name: string, createdAt: number, usedAt: number) {
  await db.runAsync(
    `INSERT INTO tags (id, name, createdAt, usedAt) VALUES (?, ?, ?, ?)`,
    id,
    name,
    createdAt,
    usedAt,
  )
}

async function insertImport(id: string, directoryId: string | null, pendingTags: string | null) {
  await db.runAsync(
    `INSERT INTO imports (id, source, directoryId, pendingTags, startedAt, updatedAt)
     VALUES (?, 'picker', ?, ?, 1, 1)`,
    id,
    directoryId,
    pendingTags,
  )
}

async function insertImportFile(id: string, importId: string, name: string, directoryId: string) {
  await db.runAsync(
    `INSERT INTO import_files (id, importId, name, type, createdAt, updatedAt, addedAt,
                               directoryId, sourceKind)
     VALUES (?, ?, ?, 'image/jpeg', 1, 1, 1, ?, 'media')`,
    id,
    importId,
    name,
    directoryId,
  )
}

const allRows = (sql: string) => db.getAllAsync<Record<string, unknown>>(sql)

it('stores every decomposed name, path and pending tag composed, without touching updatedAt or sync-up', async () => {
  await insertDir('d1', nfd('Café'))
  await insertDir('d2', nfd('Café/Été'), 'd1')
  await insertFile('f1', nfd('Résumé 2.pdf'), 'd2', { updatedAt: 42 })
  await db.runAsync(
    `INSERT INTO objects (fileId, indexerURL, id, slabs, encryptedDataKey, encryptedMetadataKey,
                          encryptedMetadata, dataSignature, metadataSignature, createdAt, updatedAt)
     VALUES ('f1', 'https://indexer', 'o1', '[]', '', '', '', '', '', 1, 1)`,
  )
  await insertTag('t1', nfd('Été'), 1, 1)
  await insertImport('i1', 'd1', JSON.stringify([nfd('Été'), 'plain']))
  await insertImportFile('if1', 'i1', nfd('Noël.jpg'), 'd1')

  await runMigration()

  expect(await allRows('SELECT id, path, nameSortKey FROM directories ORDER BY path')).toEqual([
    { id: 'd1', path: 'Café', nameSortKey: naturalSortKey('Café') },
    { id: 'd2', path: 'Café/Été', nameSortKey: naturalSortKey('Café/Été') },
  ])
  expect(await allRows('SELECT name, nameSortKey, updatedAt, current FROM files')).toEqual([
    {
      name: 'Résumé 2.pdf',
      nameSortKey: naturalSortKey('Résumé 2.pdf'),
      updatedAt: 42,
      current: 1,
    },
  ])
  expect(await allRows('SELECT needsSyncUp FROM objects')).toEqual([{ needsSyncUp: 0 }])
  expect(await allRows(`SELECT name FROM tags WHERE id = 't1'`)).toEqual([{ name: 'Été' }])
  expect(await allRows('SELECT name FROM import_files')).toEqual([{ name: 'Noël.jpg' }])
})

it('merges a decomposed folder tree into the composed one, keeping its files, subfolders and imports', async () => {
  await insertDir('nfc', 'Café', null, 5)
  await insertDir('nfcChild', 'Café/Été', 'nfc', 5)
  await insertDir('nfd', nfd('Café'), null, 1)
  await insertDir('nfdChild', nfd('Café/Été'), 'nfd', 1)
  await insertDir('nfdOnly', nfd('Café/Noël'), 'nfd', 1)
  await insertFile('a', 'a.jpg', 'nfc')
  await insertFile('b', 'b.jpg', 'nfd')
  await insertFile('c', 'c.jpg', 'nfdChild')
  await insertImport('i1', 'nfd', null)
  await insertImportFile('if1', 'i1', 'd.jpg', 'nfdChild')

  await runMigration()

  expect(await allRows('SELECT id, path, parentId FROM directories ORDER BY path')).toEqual([
    { id: 'nfc', path: 'Café', parentId: null },
    { id: 'nfdOnly', path: 'Café/Noël', parentId: 'nfc' },
    { id: 'nfcChild', path: 'Café/Été', parentId: 'nfc' },
  ])
  expect(await allRows('SELECT id, directoryId FROM files ORDER BY id')).toEqual([
    { id: 'a', directoryId: 'nfc' },
    { id: 'b', directoryId: 'nfc' },
    { id: 'c', directoryId: 'nfcChild' },
  ])
  expect(await allRows('SELECT directoryId FROM imports')).toEqual([{ directoryId: 'nfc' }])
  expect(await allRows('SELECT directoryId FROM import_files')).toEqual([
    { directoryId: 'nfcChild' },
  ])
})

it('merges tags that compose to one name, keeping every file link once', async () => {
  await insertTag('composed', 'Été', 5, 10)
  await insertTag('decomposed', nfd('Été'), 1, 20)
  // U+212A KELVIN SIGN composes to an ASCII K, so the tag it merges into is
  // not among the non-ASCII rows the migration reads.
  await insertTag('ascii', 'Kelvin', 1, 1)
  await insertTag('kelvin', '\u212Aelvin', 2, 2)
  await insertFile('f1', 'one.jpg', null)
  await insertFile('f2', 'two.jpg', null)
  for (const [fileId, tagId] of [
    ['f1', 'composed'],
    ['f1', 'decomposed'],
    ['f2', 'decomposed'],
    ['f2', 'kelvin'],
  ]) {
    await db.runAsync('INSERT INTO file_tags (fileId, tagId) VALUES (?, ?)', fileId, tagId)
  }

  await runMigration()

  expect(await allRows(`SELECT id, name, usedAt FROM tags WHERE system = 0 ORDER BY id`)).toEqual([
    { id: 'ascii', name: 'Kelvin', usedAt: 2 },
    { id: 'composed', name: 'Été', usedAt: 20 },
  ])
  expect(await allRows('SELECT fileId, tagId FROM file_tags ORDER BY fileId, tagId')).toEqual([
    { fileId: 'f1', tagId: 'composed' },
    { fileId: 'f2', tagId: 'ascii' },
    { fileId: 'f2', tagId: 'composed' },
  ])
})

it('leaves one current version and one stack id for a file split across a decomposed and a composed name', async () => {
  await insertDir('d', 'Photos')
  await insertFile('v1', nfd('Crème.jpg'), 'd', { updatedAt: 1 })
  await insertFile('v2', nfd('Crème.jpg'), 'd', { updatedAt: 2 })
  // Sync-down rewrote the newest version to the composed name, which put it
  // in a stack of its own beside the other two.
  await insertFile('v3', 'Crème.jpg', 'd', { updatedAt: 3 })
  await recalculateCurrentForGroup(db, nfd('Crème.jpg'), 'd')
  await recalculateCurrentForGroup(db, 'Crème.jpg', 'd')
  const before = await allRows('SELECT id, current, stackId FROM files ORDER BY id')
  expect(before.filter((r) => r.current === 1).map((r) => r.id)).toEqual(['v2', 'v3'])
  const v3StackId = before.find((r) => r.id === 'v3')!.stackId

  await runMigration()

  expect(await allRows('SELECT id, name, current, stackId FROM files ORDER BY id')).toEqual([
    { id: 'v1', name: 'Crème.jpg', current: 0, stackId: v3StackId },
    { id: 'v2', name: 'Crème.jpg', current: 0, stackId: v3StackId },
    { id: 'v3', name: 'Crème.jpg', current: 1, stackId: v3StackId },
  ])
})

it('changes nothing in a library of ASCII names', async () => {
  await insertDir('d1', 'Photos')
  await insertDir('d2', 'Photos/2024', 'd1')
  await insertFile('f1', 'IMG_0001.jpg', 'd2', { updatedAt: 1, current: 0 })
  await insertFile('f2', 'IMG_0001.jpg', 'd2', { updatedAt: 2 })
  await insertTag('t1', 'Trips', 1, 1)
  await db.runAsync(`INSERT INTO file_tags (fileId, tagId) VALUES ('f2', 't1')`)
  const tables = ['directories', 'files', 'tags', 'file_tags', 'feed_meta', 'feed_departures']
  const snapshot = async () =>
    Promise.all(tables.map((t) => allRows(`SELECT * FROM ${t} ORDER BY rowid`)))
  const before = await snapshot()

  await runMigration()

  expect(await snapshot()).toEqual(before)
})
