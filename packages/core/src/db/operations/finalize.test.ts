import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import type { FileRecord } from '../../types/files'
import {
  finalizeImportFile,
  insertFile,
  queryFileById,
  queryFinalizedFileIdByContentHashInDirectory,
} from './files'
import {
  claimImportFile,
  deleteImport,
  type ImportFileRow,
  type ImportRow,
  type ImportSource,
  insertImport,
  insertManyImportFiles,
  queryImportFilesByMediaAssetIds,
  recordImportFileHash,
} from './imports'
import { queryTagNamesForFile } from './tags'
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

/** Insert a directory row with a known id (FK target for files/imports.directoryId). */
async function mkdir(id: string): Promise<void> {
  await db().runAsync(
    `INSERT INTO directories (id, path, createdAt, nameSortKey) VALUES (?, ?, 1, ?)`,
    id,
    `/${id}`,
    id,
  )
}

/** Insert a pre-existing FINALIZED files row exactly as finalize would (same op path). */
async function finalizedFile(
  over: Partial<Omit<FileRecord, 'objects'>> & { id: string },
  opts: { directoryId: string | null; trashedAt?: number | null; deletedAt?: number | null },
): Promise<void> {
  await insertFile(
    db(),
    {
      name: 'existing.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 10,
      hash: 'h',
      mediaAssetId: null,
      createdAt: 1,
      updatedAt: 1,
      addedAt: 1,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: opts.trashedAt ?? null,
      deletedAt: opts.deletedAt ?? null,
      lostReason: null,
      ...over,
    },
    { directoryId: opts.directoryId },
  )
}

/** Insert an import with one file, claim it, and optionally record its hash so finalize can run. */
async function arrange(
  importRow: ImportRow,
  fileRow: ImportFileRow,
  hash: string | null,
  token: string,
): Promise<void> {
  await insertImport(db(), importRow)
  await insertManyImportFiles(db(), [fileRow])
  await claimImportFile(db(), fileRow.id, 1000, token)
  if (hash !== null) {
    await recordImportFileHash(db(), fileRow.id, token, {
      hash,
      size: fileRow.size,
      type: fileRow.type,
    })
  }
}

async function rawImportFile(id: string) {
  return db().getFirstAsync<{ state: string; claimToken: string | null }>(
    `SELECT state, claimToken FROM import_files WHERE id = ?`,
    id,
  )
}

async function rawFileRow(id: string) {
  return db().getFirstAsync<{
    id: string
    hash: string
    mediaAssetId: string | null
    directoryId: string | null
    nameSortKey: string | null
    current: number
  }>(`SELECT id, hash, mediaAssetId, directoryId, nameSortKey, current FROM files WHERE id = ?`, id)
}

describe('finalizeImportFile (real DB lifecycle)', () => {
  beforeEach(async () => {
    await setupTestDb()
    await mkdir('D')
    await mkdir('D2')
  })
  afterEach(async () => teardownTestDb())

  it('promotes an added import file into files under the same id, carrying metadata and tags', async () => {
    await arrange(
      imp({
        id: 'imp1',
        source: 'new-photos',
        directoryId: 'D',
        dedupByHash: 1,
        pendingTags: '["vacation"]',
      }),
      file({
        id: 'if1',
        importId: 'imp1',
        name: 'photo.jpg',
        directoryId: 'D',
        mediaAssetId: 'asset-1',
        size: 42,
      }),
      'h1',
      'tok',
    )

    const result = await finalizeImportFile(db(), 'if1', 'tok')
    expect(result).toEqual({ outcome: 'added' })

    // The files row reuses the import_files row's id.
    const f = await rawFileRow('if1')
    expect(f?.id).toBe('if1')
    expect(f?.hash).toBe('h1')
    expect(f?.mediaAssetId).toBe('asset-1')
    expect(f?.directoryId).toBe('D')
    expect(f?.nameSortKey).not.toBeNull() // name sorting relies on nameSortKey being computed
    expect(f?.current).toBe(1) // the sole row in (photo.jpg, D) is current

    // pendingTags applied to the finalized file.
    expect(await queryTagNamesForFile(db(), 'if1')).toEqual(['vacation'])

    // import_files row retained, marked added, claim cleared.
    expect(await rawImportFile('if1')).toEqual({ state: 'added', claimToken: null })
  })

  it('a live same-hash file in the directory makes the import a duplicate, with no files insert', async () => {
    await finalizedFile({ id: 'pre', hash: 'dup', name: 'a.jpg' }, { directoryId: 'D' })
    await arrange(
      imp({ id: 'imp1', source: 'new-photos', directoryId: 'D', dedupByHash: 1 }),
      file({ id: 'if1', importId: 'imp1', name: 'b.jpg', directoryId: 'D' }),
      'dup',
      'tok',
    )

    const result = await finalizeImportFile(db(), 'if1', 'tok')
    expect(result).toEqual({ outcome: 'duplicate' })

    expect((await rawImportFile('if1'))?.state).toBe('duplicate')
    // NO new files row was inserted for the import_file id.
    expect(await queryFileById(db(), 'if1')).toBeNull()
  })

  it('a same-hash file in another directory does not suppress the import', async () => {
    await finalizedFile({ id: 'pre', hash: 'dup', name: 'a.jpg' }, { directoryId: 'D' })
    await arrange(
      imp({ id: 'imp1', source: 'new-photos', directoryId: 'D2', dedupByHash: 1 }),
      file({ id: 'if1', importId: 'imp1', name: 'b.jpg', directoryId: 'D2' }),
      'dup',
      'tok',
    )

    const result = await finalizeImportFile(db(), 'if1', 'tok')
    expect(result).toEqual({ outcome: 'added' })

    const f = await rawFileRow('if1')
    expect(f?.id).toBe('if1')
    expect(f?.directoryId).toBe('D2') // landed in D2 despite the same-hash file living in D
  })

  it('a tombstoned same-hash file does not suppress a re-import', async () => {
    await finalizedFile(
      { id: 'pre', hash: 'ghost', name: 'a.jpg' },
      { directoryId: 'D', deletedAt: 5 },
    )
    // Guard: the live-only dedup helper itself ignores the tombstone.
    expect(await queryFinalizedFileIdByContentHashInDirectory(db(), 'ghost', 'D')).toBeNull()

    await arrange(
      imp({ id: 'imp1', source: 'new-photos', directoryId: 'D', dedupByHash: 1 }),
      file({ id: 'if1', importId: 'imp1', name: 'b.jpg', directoryId: 'D' }),
      'ghost',
      'tok',
    )

    const result = await finalizeImportFile(db(), 'if1', 'tok')
    expect(result).toEqual({ outcome: 'added' })
    const f = await rawFileRow('if1')
    expect(f?.id).toBe('if1') // a new live files row exists despite the tombstoned sibling
    expect(f?.current).toBe(1)
  })

  it('picker imports (dedupByHash=0) let identical content coexist, never a duplicate', async () => {
    await finalizedFile({ id: 'pre', hash: 'p', name: 'a.jpg' }, { directoryId: 'D' })
    await arrange(
      imp({ id: 'imp1', source: 'picker', directoryId: 'D', dedupByHash: 0 }),
      file({ id: 'if1', importId: 'imp1', name: 'b.jpg', directoryId: 'D' }),
      'p',
      'tok',
    )

    const result = await finalizeImportFile(db(), 'if1', 'tok')
    expect(result).toEqual({ outcome: 'added' })

    // Two distinct files now share hash 'p' in dir D (no content dedup for picker).
    const sharing = await db().getAllAsync<{ id: string }>(
      `SELECT id FROM files WHERE hash = 'p' AND directoryId = 'D' AND kind = 'file'
       AND trashedAt IS NULL AND deletedAt IS NULL ORDER BY id`,
    )
    expect(sharing.map((r) => r.id)).toEqual(['if1', 'pre'])
  })

  it('finalize with the wrong claim token mutates nothing', async () => {
    await arrange(
      imp({ id: 'imp1', source: 'new-photos', directoryId: 'D', dedupByHash: 1 }),
      file({ id: 'if1', importId: 'imp1', name: 'b.jpg', directoryId: 'D' }),
      'h',
      'A',
    )

    // Simulates a stale worker whose claim was swept: it finalizes with a token
    // that no longer matches the row.
    const result = await finalizeImportFile(db(), 'if1', 'B')
    expect(result).toEqual({ outcome: 'noop' })

    expect(await queryFileById(db(), 'if1')).toBeNull() // no files row
    // The row is untouched: still active under the original claim token 'A'.
    expect(await rawImportFile('if1')).toEqual({ state: 'active', claimToken: 'A' })
  })

  it('finalizing a newer same-name version makes it the current one', async () => {
    // Existing finalized 'a.jpg' in D, content hash 'old', currently the winner.
    await finalizedFile(
      { id: 'old', hash: 'old', name: 'a.jpg', updatedAt: 100 },
      { directoryId: 'D' },
    )
    // Import a NEW version of a.jpg with a different hash (dedupByHash=1, but not a dup).
    await arrange(
      imp({ id: 'imp1', source: 'new-photos', directoryId: 'D', dedupByHash: 1 }),
      file({ id: 'new', importId: 'imp1', name: 'a.jpg', directoryId: 'D', updatedAt: 200 }),
      'new',
      'tok',
    )

    const result = await finalizeImportFile(db(), 'new', 'tok')
    expect(result).toEqual({ outcome: 'added' })

    const winners = await db().getAllAsync<{ id: string }>(
      `SELECT id FROM files WHERE name = 'a.jpg' AND directoryId = 'D' AND kind = 'file'
       AND trashedAt IS NULL AND deletedAt IS NULL AND current = 1`,
    )
    // Exactly one current=1, and it's the just-finalized newest version.
    expect(winners.map((r) => r.id)).toEqual(['new'])
    expect((await rawFileRow('old'))?.current).toBe(0)
  })

  it("finalizing a row whose hash was never recorded yields hash='', which is why the scanner records the hash first", async () => {
    // recordImportFileHash is never called (hash=null), so import_files.hash
    // stays null and finalize substitutes `hash ?? ''`. Placeholder-free files
    // rows depend on the scanner recording the hash before finalizing, not on
    // this op alone.
    await arrange(
      imp({ id: 'imp1', source: 'new-photos', directoryId: 'D', dedupByHash: 1 }),
      file({ id: 'if1', importId: 'imp1', name: 'unhashed.jpg', directoryId: 'D' }),
      null, // hash never recorded
      'tok',
    )
    // Guard: the import_files row really has no hash going in.
    const before = await db().getFirstAsync<{ hash: string | null }>(
      `SELECT hash FROM import_files WHERE id = 'if1'`,
    )
    expect(before?.hash).toBeNull()

    const result = await finalizeImportFile(db(), 'if1', 'tok')
    expect(result).toEqual({ outcome: 'added' })

    const f = await rawFileRow('if1')
    expect(f?.hash).toBe('')
  })

  it('applies string tag names and drops non-string entries without throwing', async () => {
    // The non-string 123 entry exercises the malformed-tag filter.
    await arrange(
      imp({
        id: 'imp1',
        source: 'new-photos',
        directoryId: 'D',
        dedupByHash: 1,
        pendingTags: JSON.stringify(['keep', 123]),
      }),
      file({ id: 'if1', importId: 'imp1', name: 'tagged.jpg', directoryId: 'D' }),
      'h-tag',
      'tok',
    )

    const result = await finalizeImportFile(db(), 'if1', 'tok')
    expect(result).toEqual({ outcome: 'added' })

    expect(await queryTagNamesForFile(db(), 'if1')).toEqual(['keep'])
  })

  it('a zero-byte file finalizes as added with the empty-content hash, and a second identical one is a duplicate', async () => {
    // The empty-content hash is a real, stable constant (BLAKE3 of zero bytes); the
    // ops dedup by exact hash-string equality, so the value just needs to be consistent.
    const EMPTY_HASH = 'af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262'

    await insertImport(
      db(),
      imp({ id: 'imp1', source: 'new-photos', directoryId: 'D', dedupByHash: 1 }),
    )
    await insertManyImportFiles(db(), [
      file({ id: 'if1', importId: 'imp1', name: 'empty1.dat', directoryId: 'D', size: 0 }),
    ])
    await claimImportFile(db(), 'if1', 1000, 'tok1')
    await recordImportFileHash(db(), 'if1', 'tok1', {
      hash: EMPTY_HASH,
      size: 0,
      type: 'application/octet-stream',
    })
    expect(await finalizeImportFile(db(), 'if1', 'tok1')).toEqual({ outcome: 'added' })

    const first = await db().getFirstAsync<{ size: number; hash: string }>(
      `SELECT size, hash FROM files WHERE id = 'if1'`,
    )
    expect(first?.size).toBe(0)
    expect(first?.hash).toBe(EMPTY_HASH) // hash set even for empty content (not '')

    // Content dedup applies to the empty hash like any other, so a second
    // identical zero-byte import into the same directory is a duplicate.
    await insertImport(
      db(),
      imp({ id: 'imp2', source: 'new-photos', directoryId: 'D', dedupByHash: 1 }),
    )
    await insertManyImportFiles(db(), [
      file({ id: 'if2', importId: 'imp2', name: 'empty2.dat', directoryId: 'D', size: 0 }),
    ])
    await claimImportFile(db(), 'if2', 2000, 'tok2')
    await recordImportFileHash(db(), 'if2', 'tok2', {
      hash: EMPTY_HASH,
      size: 0,
      type: 'application/octet-stream',
    })
    expect(await finalizeImportFile(db(), 'if2', 'tok2')).toEqual({ outcome: 'duplicate' })
    expect((await rawImportFile('if2'))?.state).toBe('duplicate')
    expect(await queryFileById(db(), 'if2')).toBeNull()
  })

  it('deleting an import does not let photo sync re-import its finalized assets', async () => {
    // Finalize a media asset into dir D so a durable files.mediaAssetId anchor exists.
    await arrange(
      imp({ id: 'imp1', source: 'new-photos', directoryId: 'D', dedupByHash: 1 }),
      file({
        id: 'if1',
        importId: 'imp1',
        name: 'photo.jpg',
        directoryId: 'D',
        mediaAssetId: 'm1',
      }),
      'h-m1',
      'tok',
    )
    expect(await finalizeImportFile(db(), 'if1', 'tok')).toEqual({ outcome: 'added' })
    expect((await rawFileRow('if1'))?.mediaAssetId).toBe('m1')

    // Deleting the import cascades to its import_files row.
    await deleteImport(db(), 'imp1')
    expect(await rawImportFile('if1')).toBeNull()

    // Identity dedup still suppresses m1 in D: the files.mediaAssetId anchor
    // survives the import's deletion, so photo sync won't re-import the asset.
    const suppressed = await queryImportFilesByMediaAssetIds(db(), ['m1'], 'D')
    expect([...suppressed]).toEqual(['m1'])
  })
})
