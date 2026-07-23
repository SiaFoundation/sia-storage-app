import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { IMPORT_MAX_ATTEMPTS } from '../../config'
import {
  appendToOpenImportOrCreate,
  cancelImportFiles,
  failImportFilesInDirectory,
  cancelInFlightImportFiles,
  claimImportFile,
  countInFlight,
  deleteImport,
  type ImportFileRow,
  type ImportRow,
  type ImportSource,
  insertImport,
  insertManyImportFiles,
  markImportFileAdded,
  markImportFileDuplicate,
  markImportFileFailure,
  markImportFileProgress,
  markImportFileUnavailable,
  queryImportFilesByMediaAssetIds,
  queryImportById,
  queryImportFiles,
  queryImportSummary,
  queryInProgressImport,
  queryPendingImportFiles,
  rependTerminalImportFiles,
  resetStaleImportFiles,
  sealIdleImports,
  sealImport,
  updateImportSourceRef,
} from './imports'
import { IMPORT_REASONS, isImportReasonCode, UNRETRYABLE_REASONS } from './importReasons'
import { db, setupTestDb, teardownTestDb } from './test-setup'

function imp(over: Partial<ImportRow> & { id: string; source: ImportSource }): ImportRow {
  return {
    directoryId: null,
    pendingTags: null,
    expectedCount: 0,
    dedupByHash: 1,
    dirSourceRef: null,
    sealed: 1,
    startedAt: 1,
    updatedAt: 1,
    ...over,
  }
}

function file(over: Partial<ImportFileRow> & { id: string; importId: string }): ImportFileRow {
  return {
    state: 'pending',
    reason: null,
    name: 'f.jpg',
    type: 'image/jpeg',
    size: 10,
    hash: null,
    createdAt: 1,
    updatedAt: 1,
    addedAt: 1,
    directoryId: null,
    mediaAssetId: null,
    sourceKind: 'media',
    sourceUri: null,
    sourceRef: null,
    copyBytes: 0,
    attempts: 0,
    nextAttemptAt: 0,
    claimedAt: null,
    claimToken: null,
    ...over,
  }
}

describe('imports ops', () => {
  beforeEach(async () => setupTestDb())
  afterEach(async () => teardownTestDb())

  it('claims a pending row exactly once under contention', async () => {
    await insertImport(db(), imp({ id: 'i1', source: 'picker' }))
    await insertManyImportFiles(db(), [file({ id: 'a', importId: 'i1' })])

    const first = await claimImportFile(db(), 'a', 1000, 'tok-1')
    const second = await claimImportFile(db(), 'a', 1000, 'tok-2')
    expect(first).toBe(true)
    expect(second).toBe(false) // already active, second tick loses
  })

  it("ignores writes from a stale claim token (a swept-then-reclaimed row's orphan no-ops)", async () => {
    await insertImport(db(), imp({ id: 'i1', source: 'picker' }))
    await insertManyImportFiles(db(), [file({ id: 'a', importId: 'i1' })])
    await claimImportFile(db(), 'a', 1000, 'owner')

    // An orphaned op holding a stale token must not mutate the row.
    await markImportFileProgress(db(), 'a', 999, 'stale', 1_000)
    const row = await db().getFirstAsync<{ copyBytes: number }>(
      `SELECT copyBytes FROM import_files WHERE id='a'`,
    )
    expect(row?.copyBytes).toBe(0)

    await markImportFileFailure(db(), 'a', 'stale', 'boom', 2000)
    await markImportFileAdded(db(), 'a', 'stale')
    const after = await db().getFirstAsync<{ state: string; attempts: number }>(
      `SELECT state, attempts FROM import_files WHERE id='a'`,
    )
    expect(after).toEqual({ state: 'active', attempts: 0 }) // untouched
  })

  it('backs off transient failures and escalates to failed at MAX_ATTEMPTS', async () => {
    await insertImport(db(), imp({ id: 'i1', source: 'picker' }))
    // One attempt away from the ceiling.
    await insertManyImportFiles(db(), [
      file({ id: 'a', importId: 'i1', attempts: IMPORT_MAX_ATTEMPTS - 1 }),
    ])
    await claimImportFile(db(), 'a', 1000, 'tok')

    await markImportFileFailure(db(), 'a', 'tok', 'boom', 2000)
    const row = await db().getFirstAsync<{
      state: string
      attempts: number
      nextAttemptAt: number
    }>(`SELECT state, attempts, nextAttemptAt FROM import_files WHERE id='a'`)
    expect(row?.state).toBe('failed')
    expect(row?.attempts).toBe(IMPORT_MAX_ATTEMPTS)
  })

  it('one transient failure releases to pending with a future backoff', async () => {
    await insertImport(db(), imp({ id: 'i1', source: 'picker' }))
    await insertManyImportFiles(db(), [file({ id: 'a', importId: 'i1' })])
    await claimImportFile(db(), 'a', 1000, 'tok')
    await markImportFileFailure(db(), 'a', 'tok', 'boom', 2000)
    const row = await db().getFirstAsync<{
      state: string
      nextAttemptAt: number
      claimToken: string | null
    }>(`SELECT state, nextAttemptAt, claimToken FROM import_files WHERE id='a'`)
    expect(row?.state).toBe('pending')
    expect(row?.nextAttemptAt).toBeGreaterThan(2000)
    expect(row?.claimToken).toBeNull()
  })

  it('queryPendingImportFiles returns ready rows newest-first (LIFO), skipping backed-off', async () => {
    await insertImport(db(), imp({ id: 'i1', source: 'picker' }))
    await insertManyImportFiles(db(), [
      file({ id: 'old', importId: 'i1', addedAt: 100 }),
      file({ id: 'new', importId: 'i1', addedAt: 200 }),
      file({ id: 'backoff', importId: 'i1', addedAt: 300, nextAttemptAt: 9999 }),
    ])
    const ready = await queryPendingImportFiles(db(), { limit: 10, now: 1000 })
    expect(ready.map((r) => r.id)).toEqual(['new', 'old']) // backoff excluded, newest first
  })

  it('queryImportFiles search matches substrings and escapes LIKE wildcards', async () => {
    await insertImport(db(), imp({ id: 'i1', source: 'picker' }))
    await insertManyImportFiles(db(), [
      file({ id: 'a', importId: 'i1', name: 'holiday-video.mp4' }),
      file({ id: 'b', importId: 'i1', name: '100%_final.jpg' }),
      file({ id: 'c', importId: 'i1', name: 'back\\slash.png' }),
    ])
    const byName = async (search: string) =>
      (await queryImportFiles(db(), { importId: 'i1', search })).map((r) => r.name)
    expect(await byName('video')).toEqual(['holiday-video.mp4'])
    // % and _ are literals in the needle, not wildcards.
    expect(await byName('%_')).toEqual(['100%_final.jpg'])
    expect(await byName('_final')).toEqual(['100%_final.jpg'])
    expect(await byName('back\\')).toEqual(['back\\slash.png'])
    expect(await byName('nothing')).toEqual([])
  })

  it('resetStaleImportFiles releases stale claims, clamps clock-skew, and seals abandoned imports', async () => {
    await insertImport(db(), imp({ id: 'open', source: 'new-photos', sealed: 0, updatedAt: 1 }))
    await insertManyImportFiles(db(), [
      file({ id: 'stuck', importId: 'open', state: 'active', claimedAt: 1, claimToken: 'old' }),
      file({ id: 'skew', importId: 'open', state: 'pending', nextAttemptAt: 9_999_999_999_999 }),
    ])
    const now = 100_000_000
    await resetStaleImportFiles(db(), 10 * 60_000, 10 * 60_000, now)

    const stuck = await db().getFirstAsync<{ state: string; claimToken: string | null }>(
      `SELECT state, claimToken FROM import_files WHERE id='stuck'`,
    )
    expect(stuck).toEqual({ state: 'pending', claimToken: null })
    const skew = await db().getFirstAsync<{ nextAttemptAt: number }>(
      `SELECT nextAttemptAt FROM import_files WHERE id='skew'`,
    )
    expect(skew?.nextAttemptAt).toBe(now)
    const sealed = await db().getFirstAsync<{ sealed: number }>(
      `SELECT sealed FROM imports WHERE id='open'`,
    )
    expect(sealed?.sealed).toBe(1)
  })

  it('a zero claim window still honors the seal window, so a fresh open import stays open', async () => {
    const now = 100_000_000
    await insertImport(
      db(),
      imp({ id: 'fresh', source: 'new-photos', sealed: 0, updatedAt: now - 1000 }),
    )
    await insertManyImportFiles(db(), [
      file({
        id: 'orphan',
        importId: 'fresh',
        state: 'active',
        claimedAt: now - 1,
        claimToken: 'dead',
      }),
    ])
    await resetStaleImportFiles(db(), 0, 10 * 60_000, now)

    const orphan = await db().getFirstAsync<{ state: string }>(
      `SELECT state FROM import_files WHERE id='orphan'`,
    )
    expect(orphan?.state).toBe('pending') // claim reclaimed immediately
    const fresh = await db().getFirstAsync<{ sealed: number }>(
      `SELECT sealed FROM imports WHERE id='fresh'`,
    )
    expect(fresh?.sealed).toBe(0) // the just-created import is not sealed
  })

  it("derives summary status and per-state counts from an import's children", async () => {
    await insertImport(db(), imp({ id: 'i1', source: 'library-scan', sealed: 1 }))
    await insertManyImportFiles(db(), [
      file({ id: 'a', importId: 'i1', state: 'added', size: 5, copyBytes: 5 }),
      file({ id: 'b', importId: 'i1', state: 'duplicate', size: 0 }),
      file({ id: 'c', importId: 'i1', state: 'pending', size: 10, copyBytes: 3 }),
    ])
    const [s] = await queryImportSummary(db(), ['i1'])
    expect(s.added).toBe(1)
    expect(s.duplicate).toBe(1)
    expect(s.inFlight).toBe(1)
    expect(s.total).toBe(3)
    expect(s.status).toBe('queued') // sealed, a pending child, none active
    // Cumulative bytes over the whole import: totals sum every known size;
    // copied counts a finalized row's full size ('a': 5, 'b': size 0) plus the
    // in-flight heartbeat ('c': 3), so the bar climbs monotonically instead of
    // re-zeroing as rows finalize. sizedCount says byte progress is only 2/3
    // trustworthy.
    expect(s.totalBytes).toBe(15)
    expect(s.copiedBytes).toBe(8)
    expect(s.sizedCount).toBe(2)
  })

  it('queryInProgressImport finds the one non-done import per source', async () => {
    // sealed=1 with all-terminal children is done, so not in progress.
    await insertImport(db(), imp({ id: 'done', source: 'new-photos', sealed: 1 }))
    await insertManyImportFiles(db(), [file({ id: 'x', importId: 'done', state: 'added' })])
    expect(await queryInProgressImport(db(), 'new-photos')).toBeNull()

    // sealed=0 is in progress regardless of children.
    await insertImport(db(), imp({ id: 'open', source: 'new-photos', sealed: 0 }))
    expect((await queryInProgressImport(db(), 'new-photos'))?.id).toBe('open')

    await sealImport(db(), 'open', 2)
    await insertManyImportFiles(db(), [file({ id: 'y', importId: 'open', state: 'pending' })])
    expect((await queryInProgressImport(db(), 'new-photos'))?.id).toBe('open') // draining
  })

  it('dedup query is directory-scoped and checks both tables', async () => {
    await insertImport(db(), imp({ id: 'i1', source: 'new-photos' }))
    // asset1: finalized in files (unfiled), the durable anchor; suppresses.
    await db().runAsync(
      `INSERT INTO files (id, mediaAssetId, addedAt, name, size, type, kind, createdAt, updatedAt, hash, current)
       VALUES ('f1', 'asset1', 1, 'a.jpg', 1, 'image/jpeg', 'file', 1, 1, 'h', 1)`,
    )
    // asset2: in-flight import_file (unfiled); suppresses.
    await insertManyImportFiles(db(), [
      file({ id: 'if2', importId: 'i1', mediaAssetId: 'asset2', state: 'pending' }),
      // asset3: terminal unavailable; does NOT suppress (allow re-import).
      file({ id: 'if3', importId: 'i1', mediaAssetId: 'asset3', state: 'unavailable' }),
    ])

    const unfiled = await queryImportFilesByMediaAssetIds(
      db(),
      ['asset1', 'asset2', 'asset3'],
      null,
    )
    expect([...unfiled].sort()).toEqual(['asset1', 'asset2'])

    // The same assets targeting a DIFFERENT directory suppress nothing (directory-scoped).
    const otherDir = await queryImportFilesByMediaAssetIds(db(), ['asset1', 'asset2'], 'd-other')
    expect(otherDir.size).toBe(0)
  })

  it('countInFlight counts only pending/active across all imports', async () => {
    await insertImport(db(), imp({ id: 'i1', source: 'picker' }))
    await insertManyImportFiles(db(), [
      file({ id: 'a', importId: 'i1', state: 'pending' }),
      file({ id: 'b', importId: 'i1', state: 'active' }),
      file({ id: 'c', importId: 'i1', state: 'added' }),
    ])
    expect(await countInFlight(db())).toBe(2)
  })

  it('cancelImportFiles cancels in-flight rows and clears the claim', async () => {
    await insertImport(db(), imp({ id: 'i1', source: 'picker' }))
    await insertManyImportFiles(db(), [
      file({ id: 'a', importId: 'i1', state: 'active', claimToken: 'tok' }),
      file({ id: 'b', importId: 'i1', state: 'added' }),
    ])
    await cancelImportFiles(db(), ['a', 'b'])
    const a = await db().getFirstAsync<{ state: string; claimToken: string | null }>(
      `SELECT state, claimToken FROM import_files WHERE id='a'`,
    )
    expect(a).toEqual({ state: 'cancelled', claimToken: null })
    const b = await db().getFirstAsync<{ state: string }>(
      `SELECT state FROM import_files WHERE id='b'`,
    )
    expect(b?.state).toBe('added') // terminal, untouched
  })

  it("failImportFilesInDirectory fails only that directory's in-flight rows and returns their id+type", async () => {
    await insertImport(db(), imp({ id: 'i1', source: 'picker' }))
    await insertManyImportFiles(db(), [
      file({ id: 'pend', importId: 'i1', directoryId: 'd1', type: 'image/jpeg' }),
      file({ id: 'act', importId: 'i1', directoryId: 'd1', type: 'video/mp4', state: 'active' }),
      file({ id: 'done', importId: 'i1', directoryId: 'd1', state: 'added' }),
      file({ id: 'other', importId: 'i1', directoryId: 'd2' }),
    ])

    const resolved = await failImportFilesInDirectory(db(), 'd1', 'destination-deleted')

    // id+type, because the caller deletes the staged bytes at each id slot and the
    // slot path is keyed by type.
    expect(resolved.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'act', type: 'video/mp4' },
      { id: 'pend', type: 'image/jpeg' },
    ])

    const rows = await db().getAllAsync<{ id: string; state: string; reason: string | null }>(
      `SELECT id, state, reason FROM import_files ORDER BY id`,
    )
    expect(rows).toEqual([
      { id: 'act', state: 'failed', reason: 'destination-deleted' },
      { id: 'done', state: 'added', reason: null },
      { id: 'other', state: 'pending', reason: null },
      { id: 'pend', state: 'failed', reason: 'destination-deleted' },
    ])
  })

  it("rependTerminalImportFiles returns an import's failed and unavailable rows to pending, leaving added untouched", async () => {
    await insertImport(db(), imp({ id: 'i1', source: 'library-scan', sealed: 1 }))
    await insertManyImportFiles(db(), [
      file({ id: 'fail', importId: 'i1', state: 'failed', reason: 'boom', attempts: 5 }),
      file({ id: 'gone', importId: 'i1', state: 'unavailable', reason: 'icloud', attempts: 5 }),
      file({ id: 'ok', importId: 'i1', state: 'added' }),
    ])
    await rependTerminalImportFiles(db(), 'i1', 9000)

    for (const id of ['fail', 'gone']) {
      const r = await db().getFirstAsync<{
        state: string
        attempts: number
        nextAttemptAt: number
        reason: string | null
      }>(`SELECT state, attempts, nextAttemptAt, reason FROM import_files WHERE id=?`, id)
      expect(r).toEqual({ state: 'pending', attempts: 0, nextAttemptAt: 0, reason: null })
    }
    const ok = await db().getFirstAsync<{ state: string }>(
      `SELECT state FROM import_files WHERE id='ok'`,
    )
    expect(ok?.state).toBe('added') // terminal-but-successful, untouched
  })

  it("cancelInFlightImportFiles cancels an import's pending + active rows, leaving added untouched", async () => {
    await insertImport(db(), imp({ id: 'i1', source: 'picker', sealed: 1 }))
    await insertManyImportFiles(db(), [
      file({ id: 'p', importId: 'i1', state: 'pending' }),
      file({ id: 'a', importId: 'i1', state: 'active', claimToken: 'tok' }),
      file({ id: 'ok', importId: 'i1', state: 'added' }),
    ])
    await cancelInFlightImportFiles(db(), 'i1', 9000)

    for (const id of ['p', 'a']) {
      const r = await db().getFirstAsync<{ state: string; claimToken: string | null }>(
        `SELECT state, claimToken FROM import_files WHERE id=?`,
        id,
      )
      expect(r).toEqual({ state: 'cancelled', claimToken: null })
    }
    const ok = await db().getFirstAsync<{ state: string }>(
      `SELECT state FROM import_files WHERE id='ok'`,
    )
    expect(ok?.state).toBe('added') // terminal, untouched
  })

  it('sealIdleImports seals only sealed=0 imports of the source idle past the cutoff', async () => {
    // Open and idle (updatedAt well before the cutoff): both get sealed.
    await insertImport(db(), imp({ id: 'idle', source: 'new-photos', sealed: 0, updatedAt: 1000 }))
    await insertImport(db(), imp({ id: 'idle2', source: 'new-photos', sealed: 0, updatedAt: 2000 }))
    // Open but recently fed (updatedAt after the cutoff): stays open.
    await insertImport(db(), imp({ id: 'fresh', source: 'new-photos', sealed: 0, updatedAt: 9999 }))
    // Already sealed: untouched. Different source: untouched.
    await insertImport(db(), imp({ id: 'sealed', source: 'new-photos', sealed: 1, updatedAt: 1 }))
    await insertImport(db(), imp({ id: 'other', source: 'library-scan', sealed: 0, updatedAt: 1 }))

    const now = 10_000
    await sealIdleImports(db(), 'new-photos', 5000, now) // cutoff = now - idleMs = 5000

    expect((await queryImportById(db(), 'idle'))?.sealed).toBe(1)
    expect((await queryImportById(db(), 'idle'))?.updatedAt).toBe(now)
    expect((await queryImportById(db(), 'idle2'))?.sealed).toBe(1)
    expect((await queryImportById(db(), 'fresh'))?.sealed).toBe(0) // updatedAt 9999 >= 5000
    expect((await queryImportById(db(), 'other'))?.sealed).toBe(0) // wrong source
  })

  it("appendToOpenImportOrCreate creates a fresh open import when there's no in-progress import", async () => {
    const newImport = imp({
      id: 'w1',
      source: 'new-photos',
      sealed: 0,
      dedupByHash: 1,
      expectedCount: 2,
    })
    const files = [file({ id: 'x', importId: 'w1' }), file({ id: 'y', importId: 'w1' })]
    const res = await appendToOpenImportOrCreate(db(), 'new-photos', newImport, files, 500)
    expect(res).toEqual({ action: 'created', importId: 'w1' })
    expect((await queryImportById(db(), 'w1'))?.expectedCount).toBe(2)
    expect((await queryImportFiles(db(), { importId: 'w1' })).length).toBe(2)
  })

  it('appendToOpenImportOrCreate appends to the open import, re-points rows, and grows expectedCount', async () => {
    await insertImport(
      db(),
      imp({ id: 'open', source: 'new-photos', sealed: 0, expectedCount: 1, updatedAt: 1 }),
    )
    await insertManyImportFiles(db(), [file({ id: 'a', importId: 'open' })])
    // The caller can't know inside the txn whether this poll appends or
    // creates, so it builds the candidate rows against a FRESH open import id. The
    // append path must re-point them at the open import or they'd be orphaned.
    const ignored = imp({ id: 'unused', source: 'new-photos', sealed: 0, expectedCount: 2 })
    const res = await appendToOpenImportOrCreate(
      db(),
      'new-photos',
      ignored,
      [file({ id: 'b', importId: 'unused' }), file({ id: 'c', importId: 'unused' })],
      777,
    )
    expect(res).toEqual({ action: 'appended', importId: 'open' })
    const row = await queryImportById(db(), 'open')
    expect(row?.expectedCount).toBe(3) // 1 + 2 added rows
    expect(row?.updatedAt).toBe(777)
    expect(await queryImportById(db(), 'unused')).toBeNull() // no second open import created
    // Rows were re-pointed at the open import, not left dangling at 'unused'.
    const appended = await queryImportFiles(db(), { importId: 'open' })
    expect(appended.length).toBe(3)
    expect(appended.map((f) => f.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('appendToOpenImportOrCreate waits (no-op) when the open import is sealed but still draining', async () => {
    await insertImport(db(), imp({ id: 'drain', source: 'new-photos', sealed: 1, updatedAt: 1 }))
    await insertManyImportFiles(db(), [file({ id: 'p', importId: 'drain', state: 'pending' })])
    const newImport = imp({ id: 'w2', source: 'new-photos', sealed: 0, expectedCount: 1 })
    const res = await appendToOpenImportOrCreate(
      db(),
      'new-photos',
      newImport,
      [file({ id: 'q', importId: 'w2' })],
      900,
    )
    expect(res).toEqual({ action: 'waited', importId: 'drain' })
    expect(await queryImportById(db(), 'w2')).toBeNull() // nothing created
    expect((await queryImportFiles(db(), { importId: 'drain' })).length).toBe(1) // nothing appended
  })
})

describe('source-ref release and retain across terminal states', () => {
  beforeEach(async () => setupTestDb())
  afterEach(async () => teardownTestDb())

  async function activeBookmarkRow(id: string): Promise<void> {
    await insertImport(db(), imp({ id: `imp-${id}`, source: 'picker' }))
    await insertManyImportFiles(db(), [
      file({
        id,
        importId: `imp-${id}`,
        sourceKind: 'bookmark',
        sourceRef: `android-uri:${id}`,
        state: 'active',
        claimToken: 'tok',
      }),
    ])
  }
  const readRow = (id: string) =>
    db().getFirstAsync<ImportFileRow>('SELECT * FROM import_files WHERE id = ?', id)

  it('markImportFileAdded and markImportFileDuplicate null sourceRef (released on success)', async () => {
    await activeBookmarkRow('a')
    await markImportFileAdded(db(), 'a', 'tok')
    expect((await readRow('a'))?.sourceRef).toBeNull()

    await activeBookmarkRow('b')
    await markImportFileDuplicate(db(), 'b', 'tok', 'dup')
    expect((await readRow('b'))?.sourceRef).toBeNull()
  })

  it('markImportFileUnavailable and a transient markImportFileFailure retain sourceRef (Retry needs it)', async () => {
    await activeBookmarkRow('c')
    await markImportFileUnavailable(db(), 'c', 'tok', 'gone')
    expect((await readRow('c'))?.sourceRef).toBe('android-uri:c')

    await activeBookmarkRow('d')
    await markImportFileFailure(db(), 'd', 'tok', 'oops', Date.now())
    // First attempt goes back to pending; the ref is retained for the next try.
    expect((await readRow('d'))?.sourceRef).toBe('android-uri:d')
  })

  it('updateImportSourceRef writes under the matching claim and no-ops on a stale token', async () => {
    await activeBookmarkRow('e')
    await updateImportSourceRef(db(), 'e', 'wrong', 'android-uri:new')
    expect((await readRow('e'))?.sourceRef).toBe('android-uri:e') // stale token, no-op
    await updateImportSourceRef(db(), 'e', 'tok', 'android-uri:new')
    expect((await readRow('e'))?.sourceRef).toBe('android-uri:new')
  })

  it('deleteImport returns the still-held grants plus the folder tree grant for release', async () => {
    await insertImport(db(), imp({ id: 'i1', source: 'picker', dirSourceRef: 'android-tree:d1' }))
    await insertManyImportFiles(db(), [
      file({ id: 'g1', importId: 'i1', sourceKind: 'bookmark', sourceRef: 'android-uri:g1' }),
      file({ id: 'g2', importId: 'i1', sourceKind: 'ephemeral', sourceRef: null }),
    ])
    const grants = await deleteImport(db(), 'i1')
    expect(grants).toEqual(['android-uri:g1', 'android-tree:d1'])
    // CASCADE dropped the rows.
    expect(await readRow('g1')).toBeNull()
  })
})

describe('failure reason codes and retry rules', () => {
  beforeEach(async () => setupTestDb())
  afterEach(async () => teardownTestDb())

  async function seedActive(id: string, over: Partial<ImportFileRow> = {}) {
    await insertImport(db(), imp({ id: `imp-${id}`, source: 'picker' }))
    await insertManyImportFiles(db(), [
      file({
        id,
        importId: `imp-${id}`,
        state: 'active',
        claimedAt: 1_000,
        claimToken: 'tok',
        ...over,
      }),
    ])
  }

  const readFull = (id: string) =>
    db().getFirstAsync<ImportFileRow>(`SELECT * FROM import_files WHERE id = ?`, id)

  it('every reason cap is non-negative and every unretryable code is an immediate registry member', () => {
    for (const rule of Object.values(IMPORT_REASONS)) {
      expect(rule.cap).toBeGreaterThanOrEqual(0)
    }
    for (const code of UNRETRYABLE_REASONS) {
      expect(isImportReasonCode(code)).toBe(true)
      expect(IMPORT_REASONS[code].kind).toBe('immediate')
    }
  })

  it('a per-code attempt cap exhausts early instead of burning the full schedule', async () => {
    await seedActive('a')
    await markImportFileFailure(db(), 'a', 'tok', 'export-failed', 1_000, 'unavailable', 2)
    expect((await readFull('a'))?.state).toBe('pending') // attempt 1 of 2, so backoff

    // Reclaim and fail again: attempt 2 hits the cap.
    await db().runAsync(`UPDATE import_files SET state='active', claimToken='tok' WHERE id='a'`)
    await markImportFileFailure(db(), 'a', 'tok', 'export-failed', 2_000, 'unavailable', 2)
    const row = await readFull('a')
    expect(row?.state).toBe('unavailable')
    expect(row?.reason).toBe('export-failed')
    expect(row?.attempts).toBe(2)
  })

  it('progress writes heartbeat the claim so long copies survive the stale sweep', async () => {
    await seedActive('h')
    await markImportFileProgress(db(), 'h', 4_096, 'tok', 999_999)
    const row = await readFull('h')
    expect(row?.copyBytes).toBe(4_096)
    expect(row?.claimedAt).toBe(999_999)
  })

  it('retry-failed skips guaranteed-bounce codes and returns everything else to pending', async () => {
    await insertImport(db(), imp({ id: 'r1', source: 'picker' }))
    await insertManyImportFiles(db(), [
      file({ id: 'gone', importId: 'r1', state: 'unavailable', reason: 'deleted' }),
      file({ id: 'expired', importId: 'r1', state: 'unavailable', reason: 'session-expired' }),
      // A retry into a deleted destination folder can never succeed.
      file({ id: 'nodest', importId: 'r1', state: 'failed', reason: 'destination-deleted' }),
      file({ id: 'nospace', importId: 'r1', state: 'unavailable', reason: 'not-enough-space' }),
      file({ id: 'broke', importId: 'r1', state: 'failed', reason: 'io-error' }),
      file({ id: 'legacy', importId: 'r1', state: 'failed', reason: 'processing error' }),
    ])
    await rependTerminalImportFiles(db(), 'r1', 5_000)

    expect((await readFull('gone'))?.state).toBe('unavailable')
    expect((await readFull('expired'))?.state).toBe('unavailable')
    expect((await readFull('nodest'))?.state).toBe('failed')
    expect((await readFull('nospace'))?.state).toBe('pending')
    expect((await readFull('broke'))?.state).toBe('pending')
    // Pre-registry sentence reasons are retryable (unknown is not unretryable).
    expect((await readFull('legacy'))?.state).toBe('pending')
  })
})
