import type { ImportFileRow, ImportRow } from '@siastorage/core/db/operations'
import { initializeDB, resetDb } from '../db'
import { app } from './appService'
import { getImportFiles, getInProgressImport, parsePendingTags } from './imports'

function makeImport(id: string, overrides: Partial<ImportRow> = {}): ImportRow {
  return {
    id,
    source: 'picker',
    directoryId: null,
    pendingTags: null,
    expectedCount: 0,
    dedupByHash: 0,
    dirSourceRef: null,
    sealed: 1,
    startedAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

function makeImportFile(
  id: string,
  importId: string,
  overrides: Partial<ImportFileRow> = {},
): ImportFileRow {
  return {
    id,
    importId,
    state: 'pending',
    reason: null,
    name: `${id}.jpg`,
    type: 'image/jpeg',
    size: 100,
    hash: null,
    createdAt: 1000,
    updatedAt: 1000,
    addedAt: 1000,
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
    ...overrides,
  }
}

describe('imports store getters', () => {
  beforeEach(async () => {
    await initializeDB()
  })

  afterEach(async () => {
    await resetDb()
  })

  test('getImportFiles honors the limit cap', async () => {
    await app().imports.create(makeImport('imp-1'), [
      makeImportFile('f1', 'imp-1', { addedAt: 1000 }),
      makeImportFile('f2', 'imp-1', { addedAt: 2000 }),
      makeImportFile('f3', 'imp-1', { addedAt: 3000 }),
    ])
    const files = await getImportFiles('imp-1', { limit: 2 })
    expect(files.length).toBe(2)
  })

  test('getInProgressImport finds a non-done import of a source', async () => {
    await app().imports.create(makeImport('imp-1', { source: 'new-photos', sealed: 0 }), [])
    const inProgress = await getInProgressImport('new-photos')
    expect(inProgress?.id).toBe('imp-1')
    expect(await getInProgressImport('library-scan')).toBeNull()
  })
})

describe('parsePendingTags', () => {
  it('parses a JSON string array of tag names', () => {
    expect(parsePendingTags('["a","b"]')).toEqual(['a', 'b'])
  })

  it('drops non-string entries', () => {
    expect(parsePendingTags('["a",1,null,"b"]')).toEqual(['a', 'b'])
  })

  it('returns empty for null / invalid / non-array JSON', () => {
    expect(parsePendingTags(null)).toEqual([])
    expect(parsePendingTags(undefined)).toEqual([])
    expect(parsePendingTags('not json')).toEqual([])
    expect(parsePendingTags('{"a":1}')).toEqual([])
  })
})
