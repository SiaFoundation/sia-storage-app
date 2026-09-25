/*
 * Saving an edited file through the provider, a Finder save on macOS. An
 * object's bytes never change once uploaded, only its metadata, so a save must
 * become a new version with its own upload, never a relabel of the old object.
 * Two devices share one mock indexer, which keeps data and metadata apart as
 * the real one does, and every test ends by checking each stored object
 * against the bytes it holds.
 */
import { createHash } from 'node:crypto'
import * as nodeFs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { decodeFileMetadata } from '@siastorage/core/encoding/fileMetadata'
import { runCacheEviction } from '@siastorage/core/services'
import { WORKING_SET_ID } from '@siastorage/core/types'
import { createEmptyIndexerStorage, type MockIndexerStorage } from '@siastorage/sdk-mock'
import { createTestApp, type TestApp } from './app'
import { assertFeedConverges, drainListing, waitForCondition } from './utils'
import { toContentHash } from '@siastorage/core/lib/contentHash'

const sha = (bytes: Uint8Array) => toContentHash(createHash('sha256').update(bytes).digest('hex'))
const v1 = Buffer.from('first')
const v2 = Buffer.from('second version, longer')

describe('Saving a file through the provider', () => {
  let shared: MockIndexerStorage
  let A: TestApp
  let B: TestApp
  let handoff: string
  let staged = 0

  beforeEach(async () => {
    shared = createEmptyIndexerStorage()
    handoff = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'provider-write-'))
    A = createTestApp(shared, { handoffDir: handoff })
    B = createTestApp(shared, { handoffDir: handoff })
    await A.start()
    await B.start()
  })

  afterEach(async () => {
    const lies = [...shared.objects].flatMap(([objectId, stored]) => {
      const meta = decodeFileMetadata(stored.metadata)
      const data = shared.fileData.get(objectId)
      if (meta.kind !== 'file' || !data) return []
      return sha(data) === meta.hash && data.length === meta.size ? [] : [objectId]
    })
    expect({ objectsHoldingOtherBytes: lies }).toEqual({ objectsHoldingOtherBytes: [] })
    await assertFeedConverges(A)
    await assertFeedConverges(B)
    await A.shutdown()
    await B.shutdown()
    nodeFs.rmSync(handoff, { recursive: true, force: true })
  })

  function stage(bytes: Uint8Array): string {
    const file = path.join(handoff, `staged-${++staged}`)
    nodeFs.writeFileSync(file, bytes)
    return file
  }

  async function waitForContent(device: TestApp, id: string, bytes: Uint8Array) {
    await waitForCondition(
      async () => {
        const item = await device.app.provider.item(id)
        return item?.contentVersion === sha(bytes) && item.uploaded
      },
      { timeout: 30_000, message: `${id} to hold ${bytes} and be uploaded` },
    )
  }

  /** A file created on A, uploaded, and known to B. */
  async function createUploaded(name: string, bytes = v1, parentId: string | null = null) {
    const created = await A.app.provider.create(parentId, name, 'file', stage(bytes))
    await waitForContent(A, created.id, bytes)
    await waitForCondition(async () => (await B.app.provider.item(created.id)) !== null, {
      message: 'B to see the file',
    })
    // A finished upload drops its progress entry 500ms later, and would drop
    // a save's entry registered inside that window with it.
    await waitForCondition(() => A.app.uploads.getEntry(created.id) === undefined)
    return created
  }

  const save = (id: string, bytes: Uint8Array) => A.app.provider.write(id, stage(bytes))

  async function read(device: TestApp, id: string): Promise<Buffer> {
    const dest = path.join(handoff, `fetched-${++staged}`)
    await device.app.provider.fetch(id, dest)
    return nodeFs.readFileSync(dest)
  }

  describe('every reader gets the saved bytes', () => {
    it.each([
      ['differ in size', v1, v2],
      ['are the same size', Buffer.from('AAAA'), Buffer.from('BBBB')],
    ])('on another device, when the versions %s', async (_, before, after) => {
      const { id } = await createUploaded('doc.txt', before)

      await save(id, after)
      await waitForContent(B, id, after)

      expect(await read(B, id)).toEqual(after)
    })

    it('in a file created onto a name another device holds with a clock ahead of this one', async () => {
      const now = Date.now()
      B.sdk.injectObject({
        metadata: {
          id: 'future',
          name: 'clash.txt',
          type: 'text/plain',
          kind: 'file',
          size: v1.length,
          hash: sha(v1),
          createdAt: now,
          updatedAt: now + 3_600_000,
          trashedAt: null,
        },
        data: v1,
      })
      await waitForCondition(async () => (await A.app.files.getById('future')) !== null, {
        timeout: 30_000,
        message: 'A to receive the future-clocked file',
      })

      const created = await A.app.provider.create(null, 'clash.txt', 'file', stage(v2))

      expect(created.contentVersion).toBe(sha(v2))
      expect(await read(A, created.id)).toEqual(v2)
    })

    it('in a read that a newer version overtakes mid-download, labelled with the bytes it returned', async () => {
      const { id } = await createUploaded('race.txt')
      let release!: () => void
      const released = new Promise<void>((resolve) => {
        release = resolve
      })
      const download = B.sdk.downloadByObjectId.bind(B.sdk)
      jest.spyOn(B.sdk, 'downloadByObjectId').mockImplementationOnce(async (objectId) => {
        await released
        return download(objectId)
      })
      const dest = path.join(handoff, `fetched-${++staged}`)
      const fetching = B.app.provider.fetch(id, dest)
      await save(id, v2)
      await waitForContent(B, id, v2)

      release()
      const { item } = await fetching

      expect(nodeFs.readFileSync(dest)).toEqual(v1)
      expect(item.contentVersion).toBe(sha(v1))
    })

    it('after a restart lands before the upload', async () => {
      const { id } = await createUploaded('restart.txt')

      await save(id, v2)
      // What the daemon runs on exit, then a fresh upload loop over the same
      // database: the queue holding the save is gone.
      await A.app.uploader.shutdown()
      A.internal.initUploader()

      await waitForContent(A, id, v2)
      expect(await read(A, id)).toEqual(v2)
      await waitForContent(B, id, v2)
      expect(await read(B, id)).toEqual(v2)
    })

    it('in a byte range read', async () => {
      const { id } = await createUploaded('range.txt')

      await save(id, v2)
      await waitForContent(A, id, v2)

      const dest = path.join(handoff, `range-${++staged}`)
      expect(await A.app.provider.fetchRange(id, dest, 0, v2.length)).toEqual({
        offset: 0,
        bytes: v2.length,
      })
      expect(nodeFs.readFileSync(dest)).toEqual(v2)
    })

    it('after an upload attempt fails', async () => {
      const { id } = await createUploaded('retry.txt')
      // The failed save goes straight back into the next pass, so its error
      // state is too brief to poll for.
      const failures = jest.spyOn(A.app.uploads, 'setError')
      A.sdk.setUploadFailure('any', new Error('simulated network failure'))

      await save(id, v2)
      await waitForCondition(() => failures.mock.calls.length > 0, { timeout: 30_000 })
      A.sdk.clearUploadFailure('any')

      await waitForContent(B, id, v2)
      expect(await read(B, id)).toEqual(v2)
    })

    it('after a later rename pushes metadata to every version', async () => {
      const { id } = await createUploaded('rename.txt')
      await save(id, v2)
      await waitForContent(B, id, v2)

      await A.app.provider.rename(id, null, 'renamed.txt')
      await waitForCondition(async () => (await B.app.provider.item(id))?.name === 'renamed.txt')

      for (const device of [A, B]) {
        expect((await device.app.provider.item(id))?.size).toBe(v2.length)
        expect(await read(device, id)).toEqual(v2)
      }
    })
  })

  describe('what a save leaves behind', () => {
    it('identical bytes make no version, no upload and no change', async () => {
      const { id } = await createUploaded('same.txt')
      const { anchor } = await drainListing(A, WORKING_SET_ID)
      const localFiles = (await A.app.fs.listFiles()).length

      const item = await save(id, v1)

      expect(item).toEqual(await A.app.provider.item(id))
      expect(await A.app.fs.listFiles()).toHaveLength(localFiles)
      expect(await A.app.files.getVersionHistory('same.txt', null)).toHaveLength(1)
      expect(A.app.uploads.getState().uploads).toEqual({})
      expect(await A.app.provider.changes(WORKING_SET_ID, anchor)).toMatchObject({
        items: [],
        deletedIds: [],
      })
    })

    it('frees an uploaded previous version’s copy at the save, and keeps one never uploaded', async () => {
      const { id } = await createUploaded('disk.txt')
      await save(id, v2)
      A.sdk.setUploadFailure('any', new Error('hold the upload'))
      await save(id, Buffer.from('third'))

      const [, unuploaded, uploaded] = await A.app.files.getVersionHistory('disk.txt', null)
      expect(await A.app.fs.getFileUri(uploaded)).toBeNull()
      expect(await A.app.fs.getFileUri(unuploaded)).not.toBeNull()

      A.sdk.clearUploadFailure('any')
      await waitForContent(B, id, Buffer.from('third'))
    })

    it('frees a replaced version once its upload finishes after a later save', async () => {
      const { id } = await createUploaded('late.txt')
      let release!: () => void
      const released = new Promise<void>((resolve) => {
        release = resolve
      })
      const uploadPacked = A.sdk.uploadPacked.bind(A.sdk)
      jest.spyOn(A.sdk, 'uploadPacked').mockImplementationOnce(async (options) => {
        await released
        return uploadPacked(options)
      })
      await save(id, v2)
      await save(id, Buffer.from('third'))
      const [, replaced] = await A.app.files.getVersionHistory('late.txt', null)
      expect(await A.app.fs.getFileUri(replaced)).not.toBeNull()

      release()
      await waitForCondition(async () => (await A.app.localObjects.countForFile(replaced.id)) > 0, {
        timeout: 30_000,
        message: 'the replaced version to finish uploading',
      })
      await runCacheEviction(A.app, { maxBytes: Number.POSITIVE_INFINITY, minAgeNonCurrent: 0 })

      expect(await A.app.fs.getFileUri(replaced)).toBeNull()
      await waitForContent(B, id, Buffer.from('third'))
    })

    it('the saved version carries the tags and the favorite, on both devices', async () => {
      const { id } = await createUploaded('tagged.txt')
      await A.addTagToFile(id, 'Work')
      await A.app.tags.toggleFavorite(id)

      await save(id, v2)
      await waitForContent(B, id, v2)

      for (const device of [A, B]) {
        const [current] = await device.app.files.getVersionHistory('tagged.txt', null)
        await waitForCondition(async () => (await device.readTagsForFile(current.id)).length === 2)
        const names = (await device.readTagsForFile(current.id)).map((t) => t.name)
        expect(names.sort()).toEqual(['Favorites', 'Work'])
      }
    })
  })

  describe('the item the OS holds', () => {
    it('keeps its id through a save and reports the upload finishing', async () => {
      const { id } = await createUploaded('badge.txt')
      const { anchor } = await drainListing(A, WORKING_SET_ID)
      A.sdk.setUploadFailure('any', new Error('hold the upload'))

      expect(await save(id, v2)).toMatchObject({ id, contentVersion: sha(v2), uploaded: false })
      expect((await A.app.provider.progress(id)).total).toBe(v2.length)
      const pending = await A.app.provider.changes(WORKING_SET_ID, anchor)
      expect(pending.deletedIds).toEqual([])
      expect(pending.items).toEqual([expect.objectContaining({ id, uploaded: false })])

      A.sdk.clearUploadFailure('any')
      await waitForContent(A, id, v2)
      const done = await A.app.provider.changes(WORKING_SET_ID, pending.anchor)
      expect(done.deletedIds).toEqual([])
      expect(done.items).toEqual([expect.objectContaining({ id, uploaded: true })])
      expect(done.items[0].metadataVersion).not.toBe(pending.items[0].metadataVersion)
    })

    it('keeps its id through a save inside a folder, in that folder’s changes', async () => {
      const folder = await A.app.provider.create(null, 'Docs', 'dir')
      const { id } = await createUploaded('in-folder.txt', v1, folder.id)
      const { anchor } = await drainListing(A, folder.id)

      await save(id, v2)

      const changes = await A.app.provider.changes(folder.id, anchor)
      expect({ items: changes.items.map((i) => i.id), deleted: changes.deletedIds }).toEqual({
        items: [id],
        deleted: [],
      })
    })

    it('a same-name file from another device updates the item rather than replacing it', async () => {
      const { id } = await createUploaded('shared.txt')
      const { anchor } = await drainListing(A, WORKING_SET_ID)

      // The name already holds the file, so the new bytes become its newest
      // version and the create answers with the file's own item.
      expect(await B.app.provider.create(null, 'shared.txt', 'file', stage(v2))).toMatchObject({
        id,
      })
      await waitForContent(A, id, v2)

      const changes = await A.app.provider.changes(WORKING_SET_ID, anchor)
      expect(changes.deletedIds).toEqual([])
      expect(changes.items.map((i) => [i.id, i.contentVersion])).toContainEqual([id, sha(v2)])
    })

    it('removing the current version hands the id to the version behind it', async () => {
      const { id } = await createUploaded('versions.txt')
      await save(id, v2)
      const { anchor } = await drainListing(A, WORKING_SET_ID)

      const [current] = await A.app.files.getVersionHistory('versions.txt', null)
      await A.app.files.trash([current.id])

      const changes = await A.app.provider.changes(WORKING_SET_ID, anchor)
      expect(changes.deletedIds).toEqual([])
      expect(changes.items).toEqual([expect.objectContaining({ id, contentVersion: sha(v1) })])
    })

    it('a trashed and restored file goes and comes back under one id', async () => {
      const { id } = await createUploaded('restore.txt')
      await save(id, v2)
      const { anchor } = await drainListing(A, WORKING_SET_ID)
      const rows = await A.app.files.getVersionHistory('restore.txt', null)

      await A.app.provider.trash(id)
      const gone = await A.app.provider.changes(WORKING_SET_ID, anchor)
      await A.app.files.restore(rows.map((r) => r.id))
      const back = await A.app.provider.changes(WORKING_SET_ID, gone.anchor)

      expect(gone.deletedIds).toEqual([id])
      expect(back).toMatchObject({ deletedIds: [], items: [expect.objectContaining({ id })] })
    })

    it('renaming onto another file’s name leaves one item and reports the other gone', async () => {
      const kept = await createUploaded('keep.txt')
      const replaced = await createUploaded('taken.txt', v2)
      const { anchor } = await drainListing(A, WORKING_SET_ID)

      // A rename stamps the renamed versions newest, so they show at the name.
      expect(await A.app.provider.rename(kept.id, null, 'taken.txt')).toMatchObject({
        id: kept.id,
        contentVersion: sha(v1),
      })
      const changes = await A.app.provider.changes(WORKING_SET_ID, anchor)
      expect(changes.deletedIds).toEqual([replaced.id])
      expect(changes.items.map((i) => i.id)).toEqual([kept.id])
    })

    it('is never reported deleted, wherever a page of changes ends', async () => {
      const paged = createTestApp(createEmptyIndexerStorage(), {
        handoffDir: handoff,
        maxPageSize: 1,
      })
      await paged.start()
      try {
        const { id } = await paged.app.provider.create(null, 'paged.txt', 'file', stage(v1))
        let { anchor } = await drainListing(paged, WORKING_SET_ID)
        await paged.app.provider.write(id, stage(v2))
        await paged.app.provider.write(id, stage(Buffer.from('third')))

        const deleted: string[] = []
        const seen = new Set<string>()
        for (let hasMore = true; hasMore; ) {
          const page = await paged.app.provider.changes(WORKING_SET_ID, anchor)
          deleted.push(...page.deletedIds)
          for (const item of page.items) seen.add(item.id)
          ;({ anchor, hasMore } = page)
        }
        expect({ deleted, seen: [...seen] }).toEqual({ deleted: [], seen: [id] })
      } finally {
        await paged.shutdown()
      }
    })
  })
})
