import { getAssetSizes, isNativeAvailable } from 'import-sources'
import { initializeDB, resetDb } from '../db'
import { app } from '../stores/appService'
import { buildPhotoCandidateRows, importAssets } from './assetImports'
import type { Asset } from './assetImports'

beforeEach(async () => {
  await initializeDB()
})

afterEach(async () => {
  await resetDb()
  jest.restoreAllMocks()
})

function pick(over: Partial<Asset>): Asset {
  return {
    id: undefined,
    sourceUri: 'file:///tmp/a.jpg',
    type: 'image/jpeg',
    name: 'a.jpg',
    size: 100,
    timestamp: '2024-06-01T00:00:00.000Z',
    ...over,
  }
}

describe('importAssets for picker / camera / share', () => {
  it('opens a sealed=1 import with one pending row per pick (no files row)', async () => {
    const { importId } = await importAssets([pick({ name: 'one.jpg', sourceUri: 'file:///1' })])
    expect(importId).toBeTruthy()

    const imp = await app().imports.get(importId!)
    expect(imp).toMatchObject({ source: 'picker', sealed: 1, dedupByHash: 0 })
    expect(imp!.expectedCount).toBe(1)

    const rows = await app().imports.files(importId!)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ state: 'pending', name: 'one.jpg', sourceUri: 'file:///1' })
    // No finalized files row exists pre-scanner.
    expect((await app().files.getByIds([rows[0].id])).length).toBe(0)
  })

  it('every one-shot source threads through and never writes Asset.id into mediaAssetId', async () => {
    for (const source of ['picker', 'camera', 'share'] as const) {
      const { importId } = await importAssets(
        [pick({ id: 'capture-1', name: 'snap.jpg', sourceUri: `file:///${source}` })],
        'file',
        {},
        source,
      )
      const imp = await app().imports.get(importId!)
      expect(imp!.source).toBe(source)
      const rows = await app().imports.files(importId!)
      expect(rows[0].mediaAssetId).toBeNull()
    }
  })

  it('an untagged pick stages as an ephemeral row with no source ref', async () => {
    // The restart path depends on this: a pick with no durable capture is
    // recorded as session-only, never silently treated as durable.
    const { importId } = await importAssets([pick({ sourceUri: 'file:///a' })], 'file', {})
    const rows = await app().imports.files(importId!)
    expect(rows[0].sourceKind).toBe('ephemeral')
    expect(rows[0].sourceRef).toBeNull()
  })

  it('picker double-pick guard: drops exact-duplicate sourceUri within one action', async () => {
    const { importId } = await importAssets([
      pick({ name: 'dup.jpg', sourceUri: 'file:///same' }),
      pick({ name: 'dup.jpg', sourceUri: 'file:///same' }),
      pick({ name: 'other.jpg', sourceUri: 'file:///other' }),
    ])
    const rows = await app().imports.files(importId!)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.sourceUri).sort()).toEqual(['file:///other', 'file:///same'])
  })

  it('skips assets without a sourceUri and returns null when nothing is staged', async () => {
    const result = await importAssets([pick({ sourceUri: undefined })])
    expect(result).toEqual({ importId: null, newVersionCount: 0 })
  })

  it('counts picks that match an existing current file name as new versions', async () => {
    await app().files.create({
      id: 'existing',
      name: 'photo.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 10,
      hash: 'h',
      createdAt: 1,
      updatedAt: 1,
      addedAt: 1,
      mediaAssetId: null,
      trashedAt: null,
      deletedAt: null,
    })
    const { newVersionCount } = await importAssets([
      pick({ name: 'photo.jpg', sourceUri: 'file:///v2' }),
      pick({ name: 'fresh.jpg', sourceUri: 'file:///fresh' }),
    ])
    expect(newVersionCount).toBe(1)
  })

  it('does not dedup picker imports by content (dedupByHash=0), so a manual re-import always lands', async () => {
    const first = await importAssets([pick({ name: 'x.jpg', sourceUri: 'file:///x1' })])
    const second = await importAssets([pick({ name: 'x.jpg', sourceUri: 'file:///x2' })])
    expect(first.importId).not.toBe(second.importId)
    expect((await app().imports.get(first.importId!))!.dedupByHash).toBe(0)
    expect(await app().imports.files(second.importId!)).toHaveLength(1)
  })

  it('writes pendingTags as a JSON array when assignTagName is provided', async () => {
    const { importId } = await importAssets([pick({ sourceUri: 'file:///tagged' })], 'file', {
      assignTagName: 'vacation',
    })
    expect((await app().imports.get(importId!))!.pendingTags).toBe(JSON.stringify(['vacation']))
  })
})

describe('buildPhotoCandidateRows shared photo-feature builder', () => {
  function photo(id: string, name = `${id}.jpg`): Asset {
    return {
      id,
      sourceUri: `ph://${id}`,
      type: 'image/jpeg',
      name,
      size: 50,
      timestamp: '2024-06-01T00:00:00.000Z',
    }
  }

  it('builds pending rows with mediaAssetId=asset.id and sourceUri=asset.uri', async () => {
    const rows = await buildPhotoCandidateRows([photo('asset-1')], 'imp1', null, 1000)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      importId: 'imp1',
      state: 'pending',
      mediaAssetId: 'asset-1',
      sourceUri: 'ph://asset-1',
    })
  })

  it('fills missing sizes from the native size hints, keeping sizes the source provided', async () => {
    jest.mocked(isNativeAvailable).mockReturnValueOnce(true)
    jest.mocked(getAssetSizes).mockResolvedValueOnce({ 'no-size': 12345, unknown: null })
    const rows = await buildPhotoCandidateRows(
      [
        { ...photo('no-size'), size: undefined },
        { ...photo('has-size'), size: 50 },
        { ...photo('unknown'), size: undefined },
      ],
      'imp1',
      null,
      1000,
    )
    expect(rows.map((r) => [r.mediaAssetId, r.size])).toEqual([
      ['no-size', 12345], // hint applied
      ['has-size', 50], // the source-provided size wins
      ['unknown', 0], // null hint stays "no hint"
    ])
  })

  it('drops assets without an id (no dedup key)', async () => {
    const rows = await buildPhotoCandidateRows(
      [{ ...photo('asset-1'), id: undefined }],
      'imp1',
      null,
      1000,
    )
    expect(rows).toHaveLength(0)
  })

  it('skips an asset already imported into the directory (import_files row)', async () => {
    // Stage asset-1 into an existing import (state pending).
    await app().imports.create(
      {
        id: 'prior',
        source: 'new-photos',
        directoryId: null,
        pendingTags: null,
        expectedCount: 1,
        dedupByHash: 1,
        dirSourceRef: null,
        sealed: 0,
        startedAt: 1,
        updatedAt: 1,
      },
      [
        {
          id: 'p1',
          importId: 'prior',
          state: 'pending',
          reason: null,
          name: 'asset-1.jpg',
          type: 'image/jpeg',
          size: 0,
          hash: null,
          createdAt: 1,
          updatedAt: 1,
          addedAt: 1,
          directoryId: null,
          mediaAssetId: 'asset-1',
          sourceKind: 'media',
          sourceUri: null,
          sourceRef: null,
          copyBytes: 0,
          attempts: 0,
          nextAttemptAt: 0,
          claimedAt: null,
          claimToken: null,
        },
      ],
    )
    const rows = await buildPhotoCandidateRows(
      [photo('asset-1'), photo('asset-2')],
      'imp1',
      null,
      1000,
    )
    expect(rows.map((r) => r.mediaAssetId)).toEqual(['asset-2'])
  })

  it('skips an asset already finalized into the directory (files row)', async () => {
    await app().files.create({
      id: 'fin',
      name: 'asset-9.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 10,
      hash: 'h9',
      createdAt: 1,
      updatedAt: 1,
      addedAt: 1,
      mediaAssetId: 'asset-9',
      trashedAt: null,
      deletedAt: null,
    })
    const rows = await buildPhotoCandidateRows([photo('asset-9')], 'imp1', null, 1000)
    expect(rows).toHaveLength(0)
  })

  it('dedup is directory-scoped: the same asset in a different directory still imports', async () => {
    await app().files.create({
      id: 'finDirA',
      name: 'asset-5.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 10,
      hash: 'h5',
      createdAt: 1,
      updatedAt: 1,
      addedAt: 1,
      mediaAssetId: 'asset-5',
      trashedAt: null,
      deletedAt: null,
    })
    // Same asset, but the target directory is 'dirB', not a duplicate there.
    const rows = await buildPhotoCandidateRows([photo('asset-5')], 'imp1', 'dirB', 1000)
    expect(rows.map((r) => r.mediaAssetId)).toEqual(['asset-5'])
  })
})
