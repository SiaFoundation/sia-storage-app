/*
 * feed_departures under every kind of statement that can fire the triggers
 * writing it. SQLite applies the firing statement's conflict policy to a
 * trigger's own writes, and a foreign key action, an upsert and an OR IGNORE
 * statement each carry one, so a trigger that only behaves under a plain
 * statement fails here. The first cases go through the operations that
 * delete folders, which is where a folder holding several versions of one
 * file once failed the whole transaction.
 */
import {
  deleteDirectory,
  deleteDirectoryAndTrashFiles,
  deleteEmptyDirectories,
  getOrCreateDirectoryAtPath,
} from './directories'
import { insertFile, insertNextVersion, moveAllFileVersions } from './files'
import { db, setupTestDb, teardownTestDb } from './test-setup'
import { tombstoneFilesAndThumbnails } from './trash'

beforeEach(setupTestDb)
afterEach(teardownTestDb)

type Departure = { id: string; kind: string; parentId: string; reason: string; feedSeq: number }

async function departures(): Promise<Departure[]> {
  return db().getAllAsync<Departure>(
    'SELECT id, kind, parentId, reason, feedSeq FROM feed_departures ORDER BY kind, id, parentId',
  )
}

async function seq(): Promise<number> {
  return (await db().getFirstAsync<{ seq: number }>('SELECT seq FROM feed_meta WHERE id = 1'))!.seq
}

async function stackIdOf(id: string): Promise<string> {
  return (await db().getFirstAsync<{ stackId: string }>(
    'SELECT stackId FROM files WHERE id = ?',
    id,
  ))!.stackId
}

/** A file with two versions in a folder, the shape a Finder save leaves. */
async function twoVersionsIn(path: string): Promise<{ dirId: string; stackId: string }> {
  const dir = await getOrCreateDirectoryAtPath(db(), path)
  await insertFile(
    db(),
    {
      id: 'v1',
      name: 'notes.txt',
      type: 'text/plain',
      kind: 'file',
      size: 10,
      hash: 'sha256:h1',
      createdAt: 1000,
      updatedAt: 1000,
      mediaAssetId: null,
      addedAt: 1000,
      trashedAt: null,
      deletedAt: null,
    },
    { directoryId: dir.id },
  )
  expect(await insertNextVersion(db(), 'v1', { id: 'v2', size: 11, hash: 'sha256:h2' })).toBe(
    'added',
  )
  const stackId = await stackIdOf('v1')
  expect(await stackIdOf('v2')).toBe(stackId)
  return { dirId: dir.id, stackId }
}

describe('deleting a folder that holds several versions of one file', () => {
  it('trashing the folder from Finder succeeds and journals the file leaving it once', async () => {
    const { dirId, stackId } = await twoVersionsIn('Trips')

    expect(await deleteDirectoryAndTrashFiles(db(), dirId)).toBe(2)

    const fileDepartures = (await departures()).filter((d) => d.kind === 'file')
    expect(fileDepartures.map(({ id, parentId }) => ({ id, parentId }))).toEqual([
      { id: stackId, parentId: dirId },
    ])
  })

  it("sync-down's cleanup deletes the folder once both versions are deleted for good", async () => {
    const { dirId } = await twoVersionsIn('Trips')
    await tombstoneFilesAndThumbnails(db(), ['v1', 'v2'])

    expect(await deleteEmptyDirectories(db(), [dirId])).toBe(1)
    expect(await db().getFirstAsync('SELECT id FROM directories WHERE id = ?', dirId)).toBeNull()
  })

  it('a plain folder delete succeeds with both versions inside', async () => {
    const { dirId } = await twoVersionsIn('Trips')

    await deleteDirectory(db(), dirId)

    expect(await db().getFirstAsync('SELECT id FROM directories WHERE id = ?', dirId)).toBeNull()
  })

  it('a folder the file left once before records the newer departure', async () => {
    const { dirId, stackId } = await twoVersionsIn('Trips')
    await moveAllFileVersions(db(), 'notes.txt', dirId, null)
    await moveAllFileVersions(db(), 'notes.txt', null, dirId)
    await tombstoneFilesAndThumbnails(db(), ['v1', 'v2'])
    const before = await seq()

    await deleteEmptyDirectories(db(), [dirId])

    const left = (await departures()).find((d) => d.id === stackId && d.parentId === dirId)
    expect(left?.feedSeq).toBeGreaterThan(before)
  })
})

/*
 * Each departure trigger, fired by each statement shape that can reach it,
 * with a departure for the same key already recorded. The trigger must
 * succeed and leave that key holding the newer departure.
 */
async function folder(id: string, parentId: string | null = null): Promise<void> {
  await db().runAsync(
    `INSERT INTO directories (id, path, createdAt, nameSortKey, parentId) VALUES (?, ?, 1, ?, ?)`,
    id,
    parentId ? `${parentId}/${id}` : id,
    id,
    parentId,
  )
}

async function row(id: string, directoryId: string | null, stackId = 's'): Promise<void> {
  await db().runAsync(
    `INSERT INTO files (id, name, size, type, kind, createdAt, updatedAt, addedAt, hash, directoryId, stackId)
     VALUES (?, 'notes.txt', 1, 'text/plain', 'file', 1, 1, 1, 'sha256:h', ?, ?)`,
    id,
    directoryId,
    stackId,
  )
}

async function recorded(id: string, parentId: string, kind: 'file' | 'dir'): Promise<void> {
  await db().runAsync(
    `INSERT INTO feed_departures (id, kind, parentId, reason, feedSeq) VALUES (?, ?, ?, 'stale', 0)`,
    id,
    kind,
    parentId,
  )
}

async function departureFor(id: string, parentId: string): Promise<Departure | null> {
  return db().getFirstAsync<Departure>(
    'SELECT id, kind, parentId, reason, feedSeq FROM feed_departures WHERE id = ? AND parentId = ?',
    id,
    parentId,
  )
}

const FILE_MOVES: Record<string, string> = {
  'a plain update': `UPDATE files SET directoryId = NULL WHERE directoryId = 'a'`,
  'an update or ignore': `UPDATE OR IGNORE files SET directoryId = NULL WHERE directoryId = 'a'`,
  'an update or replace': `UPDATE OR REPLACE files SET directoryId = NULL WHERE directoryId = 'a'`,
  'an upsert': `INSERT INTO files (id, name, size, type, kind, createdAt, updatedAt, addedAt, hash)
    VALUES ('v1', 'notes.txt', 1, 'text/plain', 'file', 1, 1, 1, 'sha256:h'),
           ('v2', 'notes.txt', 1, 'text/plain', 'file', 1, 1, 1, 'sha256:h')
    ON CONFLICT (id) DO UPDATE SET directoryId = NULL`,
  'deleting the folder, whose foreign key clears it': `DELETE FROM directories WHERE id = 'a'`,
}

describe('a file leaving a folder, with a departure already recorded', () => {
  it.each(Object.entries(FILE_MOVES))('through %s', async (_shape, statement) => {
    await folder('a')
    await row('v1', 'a')
    await row('v2', 'a')
    await recorded('s', 'a', 'file')

    await db().runAsync(statement)

    expect(await departureFor('s', 'a')).toMatchObject({ reason: 'moved', kind: 'file' })
    expect((await departureFor('s', 'a'))!.feedSeq).toBeGreaterThan(0)
  })
})

const FOLDER_MOVES: Record<string, string> = {
  'a plain update': `UPDATE directories SET parentId = NULL WHERE id = 'child'`,
  'an update or ignore': `UPDATE OR IGNORE directories SET parentId = NULL WHERE id = 'child'`,
  'an upsert': `INSERT INTO directories (id, path, createdAt, nameSortKey, parentId)
    VALUES ('child', 'child', 1, 'child', NULL)
    ON CONFLICT (id) DO UPDATE SET parentId = NULL`,
}

describe('a folder leaving its parent, with a departure already recorded', () => {
  it.each(Object.entries(FOLDER_MOVES))('through %s', async (_shape, statement) => {
    await folder('parent')
    await folder('child', 'parent')
    await recorded('child', 'parent', 'dir')

    await db().runAsync(statement)

    expect(await departureFor('child', 'parent')).toMatchObject({ reason: 'moved', kind: 'dir' })
    expect((await departureFor('child', 'parent'))!.feedSeq).toBeGreaterThan(0)
  })
})

describe('a deletion, with a departure already recorded for the same key', () => {
  it('a file row deleted records it deleted', async () => {
    await folder('a')
    await row('v1', 'a')
    await recorded('s', 'a', 'file')

    await db().runAsync(`DELETE FROM files WHERE id = 'v1'`)

    expect(await departureFor('s', 'a')).toMatchObject({ reason: 'deleted' })
  })

  it('a folder deleted records it deleted', async () => {
    await folder('parent')
    await folder('child', 'parent')
    await recorded('child', 'parent', 'dir')

    await db().runAsync(`DELETE FROM directories WHERE id = 'child'`)

    expect(await departureFor('child', 'parent')).toMatchObject({ reason: 'deleted' })
  })

  it.each([
    ['a plain update', `UPDATE files SET stackId = 'other' WHERE id = 'v1'`],
    ['an update or ignore', `UPDATE OR IGNORE files SET stackId = 'other' WHERE id = 'v1'`],
  ])(
    "a stack's last live row taking another id records the old id deleted, through %s",
    async (_shape, statement) => {
      await folder('a')
      await row('v1', 'a')
      await recorded('s', 'a', 'file')

      await db().runAsync(statement)

      expect(await departureFor('s', 'a')).toMatchObject({ reason: 'deleted' })
      expect((await departureFor('s', 'a'))!.feedSeq).toBeGreaterThan(0)
    },
  )
})
