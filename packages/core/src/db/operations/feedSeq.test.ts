/*
 * The trigger matrix behind the provider feed: every provider-visible write
 * stamps feedSeq from feed_meta, every case that must stay silent stays
 * silent, and moves and deletes journal into feed_departures. Direct
 * checks on the mechanism the whole feed design rests on.
 */
import {
  insertDirectory,
  deleteDirectory,
  renameDirectory,
  getOrCreateDirectory,
  getOrCreateDirectoryAtPath,
  ensureDirectoriesAtPaths,
  moveDirectory,
  syncDirectoryFromMetadata,
} from './directories'
import { insertFile, updateFile, upsertManyFiles } from './files'
import { pruneFeedDepartures } from './providerChanges'
import { db, setupTestDb, teardownTestDb } from './test-setup'

beforeEach(setupTestDb)
afterEach(teardownTestDb)

async function seq(): Promise<number> {
  const row = await db().getFirstAsync<{ seq: number }>('SELECT seq FROM feed_meta WHERE id = 1')
  return row?.seq ?? -1
}

type DepartureRow = { id: string; kind: string; parentId: string; reason: string; feedSeq: number }

async function departures(): Promise<DepartureRow[]> {
  return db().getAllAsync<DepartureRow>(
    'SELECT id, kind, parentId, reason, feedSeq FROM feed_departures ORDER BY feedSeq',
  )
}

async function fileSeq(id: string): Promise<number> {
  const row = await db().getFirstAsync<{ feedSeq: number }>(
    'SELECT feedSeq FROM files WHERE id = ?',
    id,
  )
  return row?.feedSeq ?? -1
}

async function makeFile(id: string, extra: Record<string, unknown> = {}): Promise<void> {
  await insertFile(db(), {
    id,
    name: `${id}.jpg`,
    type: 'image/jpeg',
    kind: 'file',
    size: 100,
    hash: `hash-${id}`,
    createdAt: 1000,
    updatedAt: 1000,
    mediaAssetId: null,
    addedAt: 1000,
    trashedAt: null,
    deletedAt: null,
    ...extra,
  })
}

describe('feed sequence triggers', () => {
  it('a file insert stamps the row from the counter', async () => {
    const before = await seq()
    await makeFile('f1')
    // Ops may run several statements per logical write; the promise is
    // monotone stamping, with the row left at the counter's latest value.
    expect(await fileSeq('f1')).toBeGreaterThan(before)
    expect(await seq()).toBe(await fileSeq('f1'))
  })

  it.each([
    ['name', { name: 'renamed.jpg' }],
    ['size', { size: 200 }],
    ['type', { type: 'image/png' }],
    ['trashedAt', { trashedAt: 2000 }],
  ] as const)('a %s change re-stamps the row', async (_field, patch) => {
    await makeFile('f1')
    const stamped = await fileSeq('f1')
    await updateFile(db(), { id: 'f1', ...patch }, { updatedAt: 'preserve' })
    expect(await fileSeq('f1')).toBeGreaterThan(stamped)
  })

  it('a hash change, which only sync-down writes, re-stamps the row', async () => {
    await makeFile('f1')
    const stamped = await fileSeq('f1')
    await upsertManyFiles(db(), [
      {
        id: 'f1',
        name: 'f1.jpg',
        type: 'image/jpeg',
        kind: 'file',
        size: 100,
        hash: 'other',
        createdAt: 1000,
        updatedAt: 1000,
        mediaAssetId: null,
        addedAt: 1000,
        trashedAt: null,
        deletedAt: null,
      },
    ])
    expect(await fileSeq('f1')).toBeGreaterThan(stamped)
  })

  it('a bare updatedAt bump re-stamps, so tag edits reach the feed', async () => {
    await makeFile('f1')
    const stamped = await fileSeq('f1')
    await updateFile(db(), { id: 'f1' }, { updatedAt: 2000 })
    expect(await fileSeq('f1')).toBeGreaterThan(stamped)
  })

  it('an update that changes nothing visible stays silent', async () => {
    await makeFile('f1')
    const stamped = await fileSeq('f1')
    await db().runAsync(`UPDATE files SET name = name WHERE id = 'f1'`)
    expect(await fileSeq('f1')).toBe(stamped)
  })

  it('a current flip in either direction re-stamps, so promotion re-announces', async () => {
    await makeFile('f1')
    const stamped = await fileSeq('f1')
    await db().runAsync(`UPDATE files SET current = 0 WHERE id = 'f1'`)
    const demoted = await fileSeq('f1')
    expect(demoted).toBeGreaterThan(stamped)
    await db().runAsync(`UPDATE files SET current = 1 WHERE id = 'f1'`)
    expect(await fileSeq('f1')).toBeGreaterThan(demoted)
  })

  it('thumbnail rows never touch the counter, inserted or updated', async () => {
    const before = await seq()
    await makeFile('t1', { kind: 'thumb' })
    await db().runAsync(`UPDATE files SET size = 999 WHERE id = 't1'`)
    expect(await seq()).toBe(before)
  })

  it('a hard delete journals a departure from the parent it died in', async () => {
    await makeFile('f1')
    await db().runAsync(`DELETE FROM files WHERE id = 'f1'`)
    const rows = await departures()
    expect(rows).toEqual([
      { id: 'f1', kind: 'file', parentId: '', reason: 'deleted', feedSeq: await seq() },
    ])
  })

  it('a file changing folders journals a departure from the old one', async () => {
    const a = await insertDirectory(db(), 'A')
    const b = await insertDirectory(db(), 'B')
    await makeFile('f1')
    await db().runAsync(`UPDATE files SET directoryId = ? WHERE id = 'f1'`, a.id)
    await db().runAsync(`UPDATE files SET directoryId = ? WHERE id = 'f1'`, b.id)
    const rows = await departures()
    expect(rows.map((r) => [r.parentId, r.reason])).toEqual([
      ['', 'moved'],
      [a.id, 'moved'],
    ])
  })

  it("a move's row stamp takes the sequence above its ledger entry", async () => {
    const a = await insertDirectory(db(), 'A')
    await makeFile('f1')
    await db().runAsync(`UPDATE files SET directoryId = ? WHERE id = 'f1'`, a.id)
    // The depart trigger bumps first and the row stamp second, so a drained
    // working set, which never reads 'moved' rows, still ends exactly at the
    // counter's high-water mark.
    const rows = await departures()
    expect(await fileSeq('f1')).toBeGreaterThan(rows[rows.length - 1].feedSeq)
    expect(await fileSeq('f1')).toBe(await seq())
  })

  it('rewriting the same directoryId journals nothing', async () => {
    const a = await insertDirectory(db(), 'A')
    await makeFile('f1')
    await db().runAsync(`UPDATE files SET directoryId = ? WHERE id = 'f1'`, a.id)
    const before = await departures()
    await db().runAsync(`UPDATE files SET directoryId = ? WHERE id = 'f1'`, a.id)
    expect(await departures()).toEqual(before)
  })

  it("a delete supersedes the same-parent move and keeps the other parent's row", async () => {
    const a = await insertDirectory(db(), 'A')
    const b = await insertDirectory(db(), 'B')
    await makeFile('f1')
    await db().runAsync(`UPDATE files SET directoryId = ? WHERE id = 'f1'`, a.id)
    await db().runAsync(`UPDATE files SET directoryId = ? WHERE id = 'f1'`, b.id)
    await db().runAsync(`DELETE FROM files WHERE id = 'f1'`)
    const rows = await departures()
    const byParent = new Map(rows.map((r) => [r.parentId, r.reason]))
    expect(byParent.get(a.id)).toBe('moved')
    expect(byParent.get(b.id)).toBe('deleted')
  })

  it('a directory insert stamps and a get-or-create hit stays silent', async () => {
    const dir = await insertDirectory(db(), 'Docs')
    const stamped = await db().getFirstAsync<{ feedSeq: number }>(
      'SELECT feedSeq FROM directories WHERE id = ?',
      dir.id,
    )
    expect(stamped?.feedSeq).toBeGreaterThan(0)
    const before = await seq()
    await getOrCreateDirectory(db(), 'Docs')
    expect(await seq()).toBe(before)
  })

  it('the file update trigger watches exactly the fields the provider reads', async () => {
    const row = await db().getFirstAsync<{ sql: string }>(
      `SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_files_feed_update'`,
    )
    const match = /UPDATE OF (.+?)\s+ON files/s.exec(row?.sql ?? '')
    const watched = (match?.[1] ?? '')
      .split(',')
      .map((c) => c.trim())
      .sort()
    // Union of the lists the provider reads rows through: metadataVersion
    // (updatedAt, name, size, type, directoryId), contentVersion (hash), and
    // the visibility rule (current, trashedAt, deletedAt). A field added to
    // one of those without a migration extending the trigger edits items the
    // feed never announces.
    expect(watched).toEqual([
      'current',
      'deletedAt',
      'directoryId',
      'hash',
      'name',
      'size',
      'trashedAt',
      'type',
      'updatedAt',
    ])
  })

  it('a nested path creation stamps each ancestor before its descendants', async () => {
    await getOrCreateDirectoryAtPath(db(), 'a/b/c')
    const rows = await db().getAllAsync<{ path: string }>(
      'SELECT path FROM directories ORDER BY feedSeq',
    )
    // The feed pages in stamp order, and the OS shell drops a child that
    // arrives ahead of a parent it has not met.
    expect(rows.map((r) => r.path)).toEqual(['a', 'a/b', 'a/b/c'])
  })

  it('a current flip re-stamps both the demoted and the promoted row', async () => {
    await makeFile('older', { name: 'pair.jpg', updatedAt: 2000 })
    await makeFile('newer', { name: 'pair.jpg', updatedAt: 1000 })
    const before = await seq()
    await updateFile(db(), { id: 'newer' }, { updatedAt: 3000 })
    expect(await fileSeq('older')).toBeGreaterThan(before)
    expect(await fileSeq('newer')).toBeGreaterThan(before)
  })

  it('a rename re-stamps every row whose path was rewritten, and journals none', async () => {
    const parent = await insertDirectory(db(), 'Docs')
    const child = await insertDirectory(db(), 'Inner', 'Docs')
    const before = await seq()
    await renameDirectory(db(), parent.id, 'Papers')
    const rows = await db().getAllAsync<{ id: string; feedSeq: number }>(
      'SELECT id, feedSeq FROM directories',
    )
    for (const row of rows) expect(row.feedSeq).toBeGreaterThan(before)
    expect(rows.map((r) => r.id).sort()).toEqual([parent.id, child.id].sort())
    expect(await departures()).toEqual([])
  })

  it('re-parenting a folder journals one departure, for the root row only', async () => {
    const docs = await insertDirectory(db(), 'Docs')
    const inner = await insertDirectory(db(), 'Inner', 'Docs')
    await insertDirectory(db(), 'Deep', 'Docs/Inner')
    await moveDirectory(db(), inner.id, null)
    const rows = await departures()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: inner.id, kind: 'dir', parentId: docs.id, reason: 'moved' })
  })

  it('a directory delete journals every subtree row with its own parent', async () => {
    const parent = await insertDirectory(db(), 'Docs')
    const child = await insertDirectory(db(), 'Inner', 'Docs')
    await deleteDirectory(db(), parent.id)
    const rows = (await departures()).filter((r) => r.kind === 'dir')
    const byId = new Map(rows.map((r) => [r.id, r]))
    // The parent id comes from the dying row's own column, so the cascade's
    // statement order cannot blank it.
    expect(byId.get(parent.id)).toMatchObject({ parentId: '', reason: 'deleted' })
    expect(byId.get(child.id)).toMatchObject({ parentId: parent.id, reason: 'deleted' })
  })

  it('ingest that carries directoryId in the insert journals nothing', async () => {
    const dir = await insertDirectory(db(), 'Docs')
    await upsertManyFiles(
      db(),
      [
        {
          id: 'f1',
          name: 'f1.jpg',
          type: 'image/jpeg',
          kind: 'file',
          size: 100,
          hash: 'hash-f1',
          createdAt: 1000,
          updatedAt: 1000,
          mediaAssetId: null,
          addedAt: 1000,
          trashedAt: null,
          deletedAt: null,
        },
      ],
      { skipCurrentRecalc: true, directoryIdByFileId: new Map([['f1', dir.id]]) },
    )
    // The follow-up directory sync rewrites the same value, which the
    // triggers' IS NOT guards keep silent; without the id in the insert this
    // pair reads as a move out of root and journals a departure nobody saw.
    await syncDirectoryFromMetadata(db(), 'f1', 'Docs', { skipCurrentRecalc: true })
    expect(await departures()).toEqual([])
  })

  it("an upsert with a directory map leaves an unmapped existing row's folder alone", async () => {
    const dir = await insertDirectory(db(), 'Docs')
    await makeFile('kept')
    await db().runAsync(`UPDATE files SET directoryId = ? WHERE id = 'kept'`, dir.id)
    await upsertManyFiles(
      db(),
      [
        {
          id: 'kept',
          name: 'kept.jpg',
          type: 'image/jpeg',
          kind: 'file',
          size: 200,
          hash: 'hash-kept-2',
          createdAt: 1000,
          updatedAt: 2000,
          mediaAssetId: null,
          addedAt: 1000,
          trashedAt: null,
          deletedAt: null,
        },
      ],
      { skipCurrentRecalc: true, directoryIdByFileId: new Map([['other', dir.id]]) },
    )
    // directoryId is not an upsert update column, so the explicit null for an
    // unmapped id applies only to rows the batch inserts.
    const row = await db().getFirstAsync<{ directoryId: string | null; size: number }>(
      `SELECT directoryId, size FROM files WHERE id = 'kept'`,
    )
    expect(row).toEqual({ directoryId: dir.id, size: 200 })
  })

  it('pruning drops ledger rows below the horizon and records it', async () => {
    await makeFile('f1')
    await db().runAsync(`DELETE FROM files WHERE id = 'f1'`)
    const cut = (await seq()) + 1
    await makeFile('f2')
    await db().runAsync(`DELETE FROM files WHERE id = 'f2'`)
    await pruneFeedDepartures(db(), cut)
    const rows = await departures()
    expect(rows.map((r) => r.id)).toEqual(['f2'])
    const meta = await db().getFirstAsync<{ horizon: number }>(
      'SELECT horizon FROM feed_meta WHERE id = 1',
    )
    expect(meta?.horizon).toBe(cut)
  })

  it('every creation path leaves parentId matching the dirname of path', async () => {
    await getOrCreateDirectoryAtPath(db(), 'a/b/c')
    await ensureDirectoriesAtPaths(db(), ['a/q/r', 'solo'])
    await insertDirectory(db(), 'Docs')
    // Trailing slash: the parent path is sanitized before the child's path
    // and parentId are derived, so both agree.
    await insertDirectory(db(), 'Slashed', 'Docs/')
    const inner = await insertDirectory(db(), 'Inner', 'Docs')
    await moveDirectory(db(), inner.id, 'a/b')
    await renameDirectory(db(), inner.id, 'Renamed')
    const rows = await db().getAllAsync<{ id: string; path: string; parentId: string | null }>(
      'SELECT id, path, parentId FROM directories',
    )
    const idByPath = new Map(rows.map((r) => [r.path, r.id]))
    for (const row of rows) {
      const slash = row.path.lastIndexOf('/')
      const expected = slash === -1 ? null : idByPath.get(row.path.slice(0, slash))
      // An absent parent row would make expected null and let an orphan pass.
      if (slash !== -1) expect(expected).toBeDefined()
      expect([row.path, row.parentId]).toEqual([row.path, expected ?? null])
    }
  })
})
