import type { LocalObject } from '@siastorage/core/encoding/localObject'
import { runCacheEviction } from '@siastorage/core/services'
import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import * as crypto from 'crypto'
import * as nodeFs from 'fs'
import { createTestApp, generateTestFiles, type TestApp } from './app'

const INDEXER_URL = 'https://test.indexer'
const ONE_HOUR = 60 * 60 * 1000
const ONE_DAY = 24 * ONE_HOUR
const NON_CURRENT_GRACE = ONE_HOUR
const LRU_GRACE = 7 * ONE_DAY

function makeLocalObject(fileId: string): LocalObject {
  return {
    id: `obj-${fileId}`,
    fileId,
    indexerURL: INDEXER_URL,
    slabs: [],
    encryptedDataKey: new Uint8Array([1]).buffer,
    encryptedMetadataKey: new Uint8Array([2]).buffer,
    encryptedMetadata: new Uint8Array([3]).buffer,
    dataSignature: new Uint8Array([4]).buffer,
    metadataSignature: new Uint8Array([5]).buffer,
    createdAt: new Date(Date.now()),
    updatedAt: new Date(Date.now()),
  }
}

/**
 * Mirrors the disk + DB state of a real cached, uploaded thumbnail using the
 * standard adapter APIs:
 *   - `files.create(record, localObject)` inserts the file row + the indexer
 *     object row (the "uploaded" gate the eviction queries check).
 *   - `fs.writeFileData` writes bytes via the fs adapter and upserts fs meta.
 * `usedAt` is then backdated via `fs.upsertMeta` so the test can control age.
 */
async function seedUploadedThumb(
  app: TestApp,
  params: { id: string; thumbForId: string; size: number; usedAt: number },
): Promise<void> {
  const file = { id: params.id, type: 'image/webp' }
  await app.app.files.create(
    {
      ...file,
      name: `${params.id}.webp`,
      kind: 'thumb',
      size: params.size,
      hash: `hash-${params.id}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      localId: null,
      addedAt: Date.now(),
      thumbForId: params.thumbForId,
      thumbSize: 512,
      trashedAt: null,
      deletedAt: null,
    },
    makeLocalObject(params.id),
  )
  await app.app.fs.writeFileData(file, crypto.randomBytes(params.size).buffer)
  await app.app.fs.upsertMeta({
    fileId: params.id,
    size: params.size,
    addedAt: params.usedAt,
    usedAt: params.usedAt,
  })
}

/** Inserts a sibling file with the same name as `original`, marking the
 * original as `current = 0` via the recalc that runs inside `files.create`. */
async function supersedeFile(
  app: TestApp,
  original: { id: string; name: string; type: string },
  superseder: { id: string },
): Promise<void> {
  await app.app.files.create({
    id: superseder.id,
    name: original.name,
    type: original.type,
    kind: 'file',
    size: 500,
    hash: `hash-${superseder.id}`,
    createdAt: Date.now(),
    updatedAt: Date.now() + 1, // beat the original's updatedAt to win current=1
    localId: null,
    addedAt: Date.now(),
    trashedAt: null,
    deletedAt: null,
  })
}

describe('FS Cache Eviction', () => {
  let app: TestApp

  beforeEach(async () => {
    app = createTestApp(createEmptyIndexerStorage())
    await app.start()
  })

  afterEach(async () => {
    await app.shutdown()
  })

  it('trashed pass does not evict trashed local-only files', async () => {
    const [file] = await app.addFiles(generateTestFiles(1, { startId: 1, sizeBytes: 500 }))
    app.setConnected(false)
    await app.app.files.trash([file.id])

    const result = await runCacheEviction(app.app, { maxBytes: 10_000_000 })

    expect(result!.evictedFileIds).not.toContain(file.id)
    expect(await app.app.fs.readMeta(file.id)).not.toBeNull()
  }, 60_000)

  it('trashed pass evicts trashed files AND their thumbnails', async () => {
    const [file] = await app.addFiles(generateTestFiles(1, { startId: 1, sizeBytes: 500 }))
    await app.waitForNoActiveUploads()
    await seedUploadedThumb(app, {
      id: 'file-thumb',
      thumbForId: file.id,
      size: 50,
      usedAt: Date.now(),
    })
    // trashFile cascades trashedAt to the file AND every thumb where thumbForId = file.id.
    await app.app.files.trashFile(file.id)

    const result = await runCacheEviction(app.app, { maxBytes: 10_000_000 })

    expect(result!.evictedFileIds.sort()).toEqual([file.id, 'file-thumb'].sort())
    expect(await app.app.fs.readMeta(file.id)).toBeNull()
    expect(await app.app.fs.readMeta('file-thumb')).toBeNull()
  }, 60_000)

  it('non-current pass does not evict superseded files without an indexer object', async () => {
    // Local-only safety extends to non-current files: a superseded version that
    // was never uploaded must NOT be evicted, otherwise the user would lose data
    // they can't recover from the network.
    const [v1] = await app.addFiles(generateTestFiles(1, { startId: 1, sizeBytes: 500 }))
    app.setConnected(false) // keep v1 local-only
    await supersedeFile(app, v1, { id: 'v2' })
    await app.app.fs.upsertMeta({
      fileId: v1.id,
      size: v1.size,
      addedAt: Date.now() - 8 * ONE_DAY,
      usedAt: Date.now() - 8 * ONE_DAY, // well past any grace
    })

    const result = await runCacheEviction(app.app, {
      maxBytes: 10_000_000,
      minAgeNonCurrent: NON_CURRENT_GRACE,
    })

    expect(result!.evictedFileIds).not.toContain(v1.id)
    expect(await app.app.fs.readMeta(v1.id)).not.toBeNull()
  }, 60_000)

  it('non-current pass does not evict superseded files younger than minAgeNonCurrent', async () => {
    const [v1] = await app.addFiles(generateTestFiles(1, { startId: 1, sizeBytes: 500 }))
    await app.waitForNoActiveUploads()
    await supersedeFile(app, v1, { id: 'v2' })
    // v1 keeps its fresh usedAt from addFiles (now). With NON_CURRENT_GRACE = 1h,
    // v1 is younger than the gate and must be kept.

    const result = await runCacheEviction(app.app, {
      maxBytes: 10_000_000,
      minAgeNonCurrent: NON_CURRENT_GRACE,
    })

    expect(result!.evictedFileIds).not.toContain(v1.id)
    expect(await app.app.fs.readMeta(v1.id)).not.toBeNull()
  }, 60_000)

  it('non-current pass evicts superseded files AND their thumbnails', async () => {
    const [v1] = await app.addFiles(generateTestFiles(1, { startId: 1, sizeBytes: 500 }))
    await app.waitForNoActiveUploads()
    await seedUploadedThumb(app, {
      id: 'v1-thumb',
      thumbForId: v1.id,
      size: 50,
      usedAt: Date.now() - 2 * ONE_HOUR, // past 1h grace
    })
    await supersedeFile(app, v1, { id: 'v2' })
    await app.app.fs.upsertMeta({
      fileId: v1.id,
      size: v1.size,
      addedAt: Date.now() - 2 * ONE_HOUR,
      usedAt: Date.now() - 2 * ONE_HOUR,
    })

    const result = await runCacheEviction(app.app, {
      maxBytes: 10_000_000,
      minAgeNonCurrent: NON_CURRENT_GRACE,
    })

    expect(result!.evictedFileIds.sort()).toEqual([v1.id, 'v1-thumb'].sort())
    expect(await app.app.fs.readMeta(v1.id)).toBeNull()
    expect(await app.app.fs.readMeta('v1-thumb')).toBeNull()
  }, 60_000)

  it('LRU does not evict local-only files', async () => {
    // Files added but never uploaded — no objects row.
    const files = await app.addFiles(generateTestFiles(2, { startId: 1, sizeBytes: 2000 }))
    const oldTime = Date.now() - 30 * ONE_DAY
    for (const file of files) {
      await app.app.fs.upsertMeta({
        fileId: file.id,
        size: file.size,
        addedAt: oldTime,
        usedAt: oldTime,
      })
    }
    app.setConnected(false)

    const result = await runCacheEviction(app.app, { maxBytes: 100, minAge: 0 })

    expect(result!.evictedFileIds).toHaveLength(0)
    for (const file of files) {
      expect(await app.app.fs.readMeta(file.id)).not.toBeNull()
    }
  }, 60_000)

  it('LRU does not evict files younger than minAge', async () => {
    await app.addFiles(generateTestFiles(2, { startId: 1, sizeBytes: 2000 }))
    await app.waitForNoActiveUploads()

    const result = await runCacheEviction(app.app, { maxBytes: 100, minAge: LRU_GRACE })

    expect(result!.evictedFileIds).toHaveLength(0)
  }, 60_000)

  it('LRU pass never evicts thumbnails of current files', async () => {
    const [file] = await app.addFiles(generateTestFiles(1, { startId: 1, sizeBytes: 500 }))
    await app.waitForNoActiveUploads()
    // Stale thumb of a CURRENT file — protected by query, not by age.
    await seedUploadedThumb(app, {
      id: 'current-thumb',
      thumbForId: file.id,
      size: 50,
      usedAt: Date.now() - 8 * ONE_DAY,
    })
    // Backdate the file too so the LRU pass has something to evict.
    await app.app.fs.upsertMeta({
      fileId: file.id,
      size: file.size,
      addedAt: Date.now() - 8 * ONE_DAY,
      usedAt: Date.now() - 8 * ONE_DAY,
    })

    // Tight cap forces LRU to fire.
    const result = await runCacheEviction(app.app, { maxBytes: 100, minAge: LRU_GRACE })

    // The current file goes; its thumb stays even though it's stale and uploaded.
    expect(result!.evictedFileIds).toContain(file.id)
    expect(result!.evictedFileIds).not.toContain('current-thumb')
    expect(await app.app.fs.readMeta('current-thumb')).not.toBeNull()
  }, 60_000)

  it('all three passes fire in one run', async () => {
    // 1 trashed file (Pass 1) + 1 superseded file (Pass 2) + 1 stale-LRU file (Pass 3).
    // No thumbs — those are covered in their own focused tests.
    const [trashFile, superFile, staleLruFile] = await app.addFiles(
      generateTestFiles(3, { startId: 1, sizeBytes: 500 }),
    )
    await app.waitForNoActiveUploads()

    await app.app.files.trashFile(trashFile.id)

    await supersedeFile(app, superFile, { id: 'super-v2' })
    await app.app.fs.upsertMeta({
      fileId: superFile.id,
      size: superFile.size,
      addedAt: Date.now() - 2 * ONE_HOUR,
      usedAt: Date.now() - 2 * ONE_HOUR,
    })

    await app.app.fs.upsertMeta({
      fileId: staleLruFile.id,
      size: staleLruFile.size,
      addedAt: Date.now() - 8 * ONE_DAY,
      usedAt: Date.now() - 8 * ONE_DAY,
    })

    // Tight cap so LRU fires after pre-passes have already removed 1000 bytes.
    const result = await runCacheEviction(app.app, {
      maxBytes: 100,
      minAge: LRU_GRACE,
      minAgeNonCurrent: NON_CURRENT_GRACE,
    })

    expect(result!.evictedFileIds.sort()).toEqual(
      [trashFile.id, superFile.id, staleLruFile.id].sort(),
    )
  }, 60_000)

  it('LRU pass is skipped when cache is under cap; pre-passes still fire', async () => {
    const [trashFile] = await app.addFiles(generateTestFiles(1, { startId: 1, sizeBytes: 500 }))
    await app.waitForNoActiveUploads()
    await app.app.files.trashFile(trashFile.id)

    const [superFile] = await app.addFiles(generateTestFiles(1, { startId: 2, sizeBytes: 500 }))
    await app.waitForNoActiveUploads()
    await supersedeFile(app, superFile, { id: 'super-v2' })
    await app.app.fs.upsertMeta({
      fileId: superFile.id,
      size: superFile.size,
      addedAt: Date.now() - 2 * ONE_HOUR,
      usedAt: Date.now() - 2 * ONE_HOUR,
    })

    // Stale current file — would be the oldest LRU candidate, but cap is generous.
    const [staleCurrentFile] = await app.addFiles(
      generateTestFiles(1, { startId: 3, sizeBytes: 500 }),
    )
    await app.waitForNoActiveUploads()
    await app.app.fs.upsertMeta({
      fileId: staleCurrentFile.id,
      size: staleCurrentFile.size,
      addedAt: Date.now() - 30 * ONE_DAY,
      usedAt: Date.now() - 30 * ONE_DAY,
    })

    const result = await runCacheEviction(app.app, {
      maxBytes: 10_000_000,
      minAge: LRU_GRACE,
      minAgeNonCurrent: NON_CURRENT_GRACE,
    })

    expect(result!.evictedFileIds).toContain(trashFile.id)
    expect(result!.evictedFileIds).toContain(superFile.id)
    expect(result!.evictedFileIds).not.toContain(staleCurrentFile.id)
    expect(await app.app.fs.readMeta(staleCurrentFile.id)).not.toBeNull()
  }, 60_000)

  it('aborts mid-eviction when the AbortSignal fires', async () => {
    // Pre-abort the signal so eviction returns immediately after the first
    // batch query, before removing any rows.
    const files = await app.addFiles(generateTestFiles(5, { startId: 1, sizeBytes: 100 }))
    await app.waitForNoActiveUploads()
    for (const file of files) {
      await app.app.files.trashFile(file.id)
    }

    const controller = new AbortController()
    controller.abort()
    const result = await runCacheEviction(app.app, { maxBytes: 10_000_000 }, controller.signal)

    expect(result!.evictedFileIds).toHaveLength(0)
    for (const file of files) {
      expect(await app.app.fs.readMeta(file.id)).not.toBeNull()
    }
  }, 60_000)

  it('getFsFileUri cleans up metadata when file is missing from disk', async () => {
    const fileFactories = generateTestFiles(1, { startId: 1, sizeBytes: 100 })
    const [file] = await app.addFiles(fileFactories)

    const uriBefore = await app.getFsFileUri({
      id: file.id,
      type: file.type,
    })
    expect(uriBefore).not.toBeNull()

    const metaBefore = await app.app.fs.readMeta(file.id)
    expect(metaBefore).not.toBeNull()

    // Delete the file from disk without updating metadata
    const filePath = uriBefore!.replace('file://', '')
    nodeFs.unlinkSync(filePath)

    const uriAfter = await app.getFsFileUri({
      id: file.id,
      type: file.type,
    })
    expect(uriAfter).toBeNull()

    const metaAfter = await app.app.fs.readMeta(file.id)
    expect(metaAfter).toBeNull()
  })

  it('getFsFileUri auto-tracks untracked files on disk', async () => {
    const fileFactories = generateTestFiles(1, { startId: 1, sizeBytes: 100 })
    const [file] = await app.addFiles(fileFactories)

    const uri = await app.getFsFileUri({ id: file.id, type: file.type })
    expect(uri).not.toBeNull()

    // Manually delete the metadata but keep the file on disk
    await app.app.fs.deleteMeta(file.id)
    const metaGone = await app.app.fs.readMeta(file.id)
    expect(metaGone).toBeNull()

    // getFsFileUri should re-insert the metadata
    const uri2 = await app.getFsFileUri({ id: file.id, type: file.type })
    expect(uri2).not.toBeNull()

    const metaRestored = await app.app.fs.readMeta(file.id)
    expect(metaRestored).not.toBeNull()
    expect(metaRestored!.fileId).toBe(file.id)
  })

  it('getFsFileUri throttles usedAt updates', async () => {
    const fileFactories = generateTestFiles(1, { startId: 1, sizeBytes: 100 })
    const [file] = await app.addFiles(fileFactories)

    await app.getFsFileUri({ id: file.id, type: file.type })
    const meta1 = await app.app.fs.readMeta(file.id)

    // Second call within throttle window should not update usedAt
    await app.getFsFileUri({ id: file.id, type: file.type })
    const meta2 = await app.app.fs.readMeta(file.id)
    expect(meta2!.usedAt).toBe(meta1!.usedAt)
  })
})
