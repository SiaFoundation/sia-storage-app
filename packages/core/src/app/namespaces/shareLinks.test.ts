import type { SdkAdapter, SharingKeyRecord } from '../../adapters/sdk'
import { insertDirectory } from '../../db/operations/directories'
import { insertFile } from '../../db/operations/files'
import { insertObject } from '../../db/operations/localObjects'
import {
  deleteShareLinkObject,
  insertShareLink,
  insertShareLinkFile,
  queryShareLinkFiles,
  queryShareLinkObjectFiles,
  updateShareLinkFile,
  upsertShareLinkObject,
} from '../../db/operations/shareLinks'
import { restoreFilesAndThumbnails, trashFilesAndThumbnails } from '../../db/operations/trash'
import { db, setupTestDb, teardownTestDb } from '../../db/operations/test-setup'
import { encodeFileMetadata } from '../../encoding/fileMetadata'
import { buildShareLinks } from './shareLinks'

const INDEXER = 'https://idx.example.com'

beforeEach(setupTestDb)
afterEach(teardownTestDb)

describe('share links after a restart', () => {
  it('a link listed before a restart has its address after it with no network', async () => {
    const record: SharingKeyRecord = {
      key: { publicKey: 'ed25519:link', seed: new Uint8Array(32).fill(7) },
      description: 'Sia Storage',
      createdAt: new Date(1),
      objectCount: 0,
    }
    const online = {
      sharingKeys: async (offset: number) => (offset === 0 ? [record] : []),
      sharedObjects: async () => [],
    } as unknown as SdkAdapter
    const build = (requireSdk: () => SdkAdapter) =>
      buildShareLinks({
        db: db(),
        requireSdk,
        getIndexerURL: async () => INDEXER,
        invalidate: () => {},
      })
    await build(() => online).syncLinks({ refresh: true })

    // A restart builds the namespace again over the same database.
    const restarted = build(() => {
      throw new Error('offline')
    })

    expect((await restarted.links()).map((l) => l.url)).toEqual([
      `https://share.sia.storage/#share=${'07'.repeat(32)}`,
    ])
  })
})

/*
 * A trashed row is in no folder, which reads as the top of the library. These
 * tests build that state directly: a trashed notes.txt at the top of the
 * library that a link names, beside a live notes.txt there that was never
 * shared.
 */
describe('a shared file in the trash', () => {
  const PUBLIC_KEY = 'ed25519:link'
  const seed = new Uint8Array(32).fill(7)

  async function addNotes(
    id: string,
    trashedAt: number | null,
    opts: { updatedAt?: number; uploaded?: boolean } = {},
  ): Promise<void> {
    await insertFile(
      db(),
      {
        id,
        name: 'notes.txt',
        type: 'text/plain',
        kind: 'file',
        size: 10,
        hash: `sha256:${id}`,
        createdAt: 1000,
        updatedAt: opts.updatedAt ?? trashedAt ?? 2000,
        mediaAssetId: null,
        addedAt: 1000,
        trashedAt,
        deletedAt: null,
      },
      { directoryId: null },
    )
    if (opts.uploaded === false) return
    await insertObject(db(), {
      fileId: id,
      indexerURL: INDEXER,
      id: `obj-${id}`,
      slabs: [],
      encryptedDataKey: new Uint8Array([1]).buffer,
      encryptedMetadataKey: new Uint8Array([1]).buffer,
      encryptedMetadata: new Uint8Array([1]).buffer,
      dataSignature: new Uint8Array([1]).buffer,
      metadataSignature: new Uint8Array([1]).buffer,
      createdAt: new Date(1000),
      updatedAt: new Date(1000),
    })
  }

  /** An indexer that lists the link with the given files' objects attached, and records every change. */
  function indexer(listed: string[] = ['shared'], opts: { attachFails?: boolean } = {}) {
    const shared: string[] = []
    const unshared: string[] = []
    const sdk = {
      sharingKeys: async (offset: number) =>
        offset === 0
          ? [
              {
                key: { publicKey: PUBLIC_KEY, seed },
                description: 'Sia Storage',
                createdAt: new Date(1),
                objectCount: 1,
              } satisfies SharingKeyRecord,
            ]
          : [],
      sharedObjects: async (_key: unknown, offset: number) =>
        offset === 0
          ? listed.map((id) => ({
              id: () => `obj-${id}`,
              metadata: () =>
                encodeFileMetadata({
                  id,
                  name: 'notes.txt',
                  type: 'text/plain',
                  kind: 'file',
                  size: 10,
                  hash: `sha256:${id}`,
                  createdAt: 1000,
                  updatedAt: 2000,
                  trashedAt: null,
                }),
            }))
          : [],
      appKey: () => ({}),
      openPinnedObject: (_appKey: unknown, object: { id: string }) => ({
        id: object.id,
        updateMetadata: () => {},
      }),
      shareObject: async (_key: unknown, object: { id: string }) => {
        if (opts.attachFails) throw new Error('connection reset')
        shared.push(object.id)
      },
      unshareObject: async (_key: unknown, objectId: string) => {
        unshared.push(objectId)
      },
    } as unknown as SdkAdapter
    const links = buildShareLinks({
      db: db(),
      requireSdk: () => sdk,
      getIndexerURL: async () => INDEXER,
      invalidate: () => {},
    })
    return { links, shared, unshared }
  }

  beforeEach(async () => {
    await addNotes('shared', 3000)
    await addNotes('other', null)
  })

  async function addLink(mode: 'latest' | 'snapshot'): Promise<void> {
    await insertShareLink(db(), {
      publicKey: PUBLIC_KEY,
      seed: '07'.repeat(32),
      indexerURL: INDEXER,
      createdAt: 1,
      expiresAt: null,
      mode,
    })
  }

  for (const mode of ['latest', 'snapshot'] as const) {
    it(`a ${mode} link drops it and never puts on the live file with its name`, async () => {
      await addLink(mode)
      await insertShareLinkFile(db(), PUBLIC_KEY, 'shared', 'shared')
      await upsertShareLinkObject(db(), PUBLIC_KEY, 'obj-shared', 1000)
      const { links, shared, unshared } = indexer()

      await links.syncLinks({ refresh: true })

      expect(shared).toEqual([])
      expect(unshared).toEqual(['obj-shared'])
      expect((await links.links())[0].files).toEqual([])
    })
  }

  it("is not taken onto this device's list when another device attached it, and is detached", async () => {
    const { links, shared, unshared } = indexer()

    await links.syncLinks({ refresh: true })

    expect(shared).toEqual([])
    expect(unshared).toEqual(['obj-shared'])
    expect((await links.links())[0].files).toEqual([])
  })

  it('does not take another file with its name off a latest link that shares both', async () => {
    await addLink('latest')
    await insertShareLinkFile(db(), PUBLIC_KEY, 'shared', 'shared')
    await insertShareLinkFile(db(), PUBLIC_KEY, 'other', 'shared')
    await upsertShareLinkObject(db(), PUBLIC_KEY, 'obj-other', 2000)
    const { links, shared, unshared } = indexer(['other'])

    await links.syncLinks({ refresh: true })

    expect(shared).toEqual([])
    expect(unshared).toEqual([])
    expect((await links.links())[0].files.map((f) => [f.fileId, f.state])).toEqual([
      ['other', 'shared'],
    ])
  })

  it('comes off while another file with its name waits to upload', async () => {
    await addNotes('newer', null, { updatedAt: 5000, uploaded: false })
    await addLink('latest')
    await insertShareLinkFile(db(), PUBLIC_KEY, 'other', 'shared')
    await upsertShareLinkObject(db(), PUBLIC_KEY, 'obj-shared', 2000)
    await upsertShareLinkObject(db(), PUBLIC_KEY, 'obj-other', 2000)
    const { links, unshared } = indexer(['shared', 'other'])

    await links.syncLinks({ refresh: true })

    expect(unshared).toEqual(['obj-shared'])
    expect((await links.links())[0].files.map((f) => [f.fileId, f.state])).toEqual([
      ['newer', 'pending'],
    ])
  })

  it('comes off when attaching another file fails', async () => {
    await addLink('latest')
    await insertShareLinkFile(db(), PUBLIC_KEY, 'other', 'pending')
    await upsertShareLinkObject(db(), PUBLIC_KEY, 'obj-shared', 2000)
    const { links, unshared } = indexer(['shared'], { attachFails: true })

    await links.syncLinks({ refresh: true })

    expect(unshared).toEqual(['obj-shared'])
  })

  it('does not keep this device from taking on a live file with its name another device shared', async () => {
    await addLink('latest')
    await insertShareLinkFile(db(), PUBLIC_KEY, 'shared', 'shared')
    const { links, unshared } = indexer(['other'])

    await links.syncLinks({ refresh: true })

    expect(unshared).toEqual([])
    expect((await links.links())[0].files.map((f) => [f.fileId, f.state])).toEqual([
      ['other', 'shared'],
    ])
  })
})

/*
 * The trash takes a file off its links in the transaction that trashes it,
 * and marks its attached objects for the next pass to detach. The mark has to
 * hold when the file is restored before that pass runs, as it is when the
 * device is offline in between.
 */
describe('a file put in the trash', () => {
  const PUBLIC_KEY = 'ed25519:link'

  beforeEach(async () => {
    await insertFile(db(), {
      id: 'report',
      name: 'report.txt',
      type: 'text/plain',
      kind: 'file',
      size: 10,
      hash: 'sha256:report',
      createdAt: 1000,
      updatedAt: 1000,
      mediaAssetId: null,
      addedAt: 1000,
      trashedAt: null,
      deletedAt: null,
    })
    await insertObject(db(), {
      fileId: 'report',
      indexerURL: INDEXER,
      id: 'obj-report',
      slabs: [],
      encryptedDataKey: new Uint8Array([1]).buffer,
      encryptedMetadataKey: new Uint8Array([1]).buffer,
      encryptedMetadata: new Uint8Array([1]).buffer,
      dataSignature: new Uint8Array([1]).buffer,
      metadataSignature: new Uint8Array([1]).buffer,
      createdAt: new Date(1000),
      updatedAt: new Date(1000),
    })
    await insertShareLink(db(), {
      publicKey: PUBLIC_KEY,
      seed: '07'.repeat(32),
      indexerURL: INDEXER,
      createdAt: 1,
      expiresAt: null,
      mode: 'latest',
    })
    await insertShareLinkFile(db(), PUBLIC_KEY, 'report', 'shared')
    await upsertShareLinkObject(db(), PUBLIC_KEY, 'obj-report', 1000)
  })

  it('leaves every link, and its attached object is marked to come off', async () => {
    await trashFilesAndThumbnails(db(), ['report'])

    expect(await queryShareLinkFiles(db(), PUBLIC_KEY)).toEqual([])
    expect(
      (await queryShareLinkObjectFiles(db(), PUBLIC_KEY, INDEXER)).map((o) => [
        o.objectId,
        o.detaching,
      ]),
    ).toEqual([['obj-report', 1]])
  })

  /**
   * An indexer listing obj-report while it is attached. `onShare` runs while
   * an attach is in flight, between the indexer taking it and the pass
   * recording it.
   */
  function linksOnIndexer(attached: boolean, onShare: () => Promise<void> = async () => {}) {
    const shared: string[] = []
    const unshared: string[] = []
    const sdk = {
      sharingKeys: async (offset: number) =>
        offset === 0
          ? [
              {
                key: { publicKey: PUBLIC_KEY, seed: new Uint8Array(32).fill(7) },
                description: 'Sia Storage',
                createdAt: new Date(1),
                objectCount: 1,
              } satisfies SharingKeyRecord,
            ]
          : [],
      sharedObjects: async (_key: unknown, offset: number) =>
        offset === 0 && attached
          ? [
              {
                id: () => 'obj-report',
                metadata: () =>
                  encodeFileMetadata({
                    id: 'report',
                    name: 'report.txt',
                    type: 'text/plain',
                    kind: 'file',
                    size: 10,
                    hash: 'sha256:report',
                    createdAt: 1000,
                    updatedAt: 1000,
                    trashedAt: null,
                  }),
              },
            ]
          : [],
      appKey: () => ({}),
      openPinnedObject: (_appKey: unknown, object: { id: string }) => ({
        id: object.id,
        updateMetadata: () => {},
      }),
      shareObject: async (_key: unknown, object: { id: string }) => {
        shared.push(object.id)
        attached = true
        await onShare()
      },
      unshareObject: async (_key: unknown, objectId: string) => {
        unshared.push(objectId)
        attached = false
      },
    } as unknown as SdkAdapter
    const links = buildShareLinks({
      db: db(),
      requireSdk: () => sdk,
      getIndexerURL: async () => INDEXER,
      invalidate: () => {},
    })
    return { links, shared, unshared }
  }

  it('comes off the link when restored before the next pass, and is not put back', async () => {
    await trashFilesAndThumbnails(db(), ['report'])
    await restoreFilesAndThumbnails(db(), ['report'])
    const { links, shared, unshared } = linksOnIndexer(true)

    await links.syncLinks({ refresh: true })
    await links.syncLinks({ refresh: true })

    expect(shared).toEqual([])
    expect(unshared).toEqual(['obj-report'])
    expect((await links.links())[0].files).toEqual([])
  })

  it('comes off the link when trashed and restored while its attach is in flight', async () => {
    await deleteShareLinkObject(db(), PUBLIC_KEY, 'obj-report')
    await updateShareLinkFile(db(), PUBLIC_KEY, 'report', { fileId: 'report', state: 'pending' })
    const { links, shared, unshared } = linksOnIndexer(false, async () => {
      await trashFilesAndThumbnails(db(), ['report'])
      await restoreFilesAndThumbnails(db(), ['report'])
    })

    await links.syncLinks({ refresh: true })
    await links.syncLinks({ refresh: true })
    await links.syncLinks({ refresh: true })

    expect(shared).toEqual(['obj-report'])
    expect(unshared).toEqual(['obj-report'])
    expect((await links.links())[0].files).toEqual([])
  })
})

describe('a file another device put on a link', () => {
  it('stays attached when this device syncs it after listing the link', async () => {
    const PUBLIC_KEY = 'ed25519:link'
    const sdk = {
      sharingKeys: async (offset: number) =>
        offset === 0
          ? [
              {
                key: { publicKey: PUBLIC_KEY, seed: new Uint8Array(32).fill(7) },
                description: 'Sia Storage',
                createdAt: new Date(1),
                objectCount: 1,
              } satisfies SharingKeyRecord,
            ]
          : [],
      sharedObjects: async (_key: unknown, offset: number) =>
        offset === 0
          ? [
              {
                id: () => 'obj-added',
                metadata: () =>
                  encodeFileMetadata({
                    id: 'added',
                    name: 'added.txt',
                    type: 'text/plain',
                    kind: 'file',
                    size: 10,
                    hash: 'sha256:added',
                    createdAt: 1000,
                    updatedAt: 1000,
                    trashedAt: null,
                  }),
              },
            ]
          : [],
      unshareObject: jest.fn(async () => {}),
    } as unknown as SdkAdapter
    const links = buildShareLinks({
      db: db(),
      requireSdk: () => sdk,
      getIndexerURL: async () => INDEXER,
      invalidate: () => {},
    })
    await links.syncLinks({ refresh: true })

    // Sync-down brings in the file after the listing, and the next pass does
    // not list the link again.
    await insertFile(db(), {
      id: 'added',
      name: 'added.txt',
      type: 'text/plain',
      kind: 'file',
      size: 10,
      hash: 'sha256:added',
      createdAt: 1000,
      updatedAt: 1000,
      mediaAssetId: null,
      addedAt: 1000,
      trashedAt: null,
      deletedAt: null,
    })
    await insertObject(db(), {
      fileId: 'added',
      indexerURL: INDEXER,
      id: 'obj-added',
      slabs: [],
      encryptedDataKey: new Uint8Array([1]).buffer,
      encryptedMetadataKey: new Uint8Array([1]).buffer,
      encryptedMetadata: new Uint8Array([1]).buffer,
      dataSignature: new Uint8Array([1]).buffer,
      metadataSignature: new Uint8Array([1]).buffer,
      createdAt: new Date(1000),
      updatedAt: new Date(1000),
    })
    await links.syncLinks()

    expect(sdk.unshareObject).not.toHaveBeenCalled()
  })
})

describe('the order share views list files in', () => {
  const offline = () =>
    buildShareLinks({
      db: db(),
      requireSdk: () => {
        throw new Error('offline')
      },
      getIndexerURL: async () => INDEXER,
      invalidate: () => {},
    })

  async function addFile(id: string, name: string, directoryId: string | null = null) {
    await insertFile(
      db(),
      {
        id,
        name,
        type: 'image/jpeg',
        kind: 'file',
        size: 100,
        hash: `sha256:${id}`,
        createdAt: 1,
        updatedAt: 1,
        addedAt: 1,
        mediaAssetId: null,
        trashedAt: null,
        deletedAt: null,
      },
      { directoryId },
    )
  }

  /**
   * Files picked out of name order. A plain string sort would put Saturn
   * before aurora and Day 10 before Day 2. Earth and Earthset, and Trips and
   * Trips/Rome, check that a name or path comes before one it is a prefix of.
   */
  async function addLibrary(): Promise<string[]> {
    const trips = await insertDirectory(db(), 'Trips')
    const rome = await insertDirectory(db(), 'Rome', 'Trips')
    await addFile('saturn', 'Saturn.jpg')
    await addFile('rome-10', 'Day 10.jpg', rome.id)
    await addFile('earthset', 'Earthset.jpg')
    await addFile('trips-map', 'map.png', trips.id)
    await addFile('aurora', 'aurora.jpg')
    await addFile('rome-2', 'Day 2.jpg', rome.id)
    await addFile('earth', 'Earth.jpg')
    return ['saturn', 'rome-10', 'earthset', 'trips-map', 'aurora', 'rome-2', 'earth']
  }

  const ORDER = [
    { name: 'aurora.jpg', folder: null },
    { name: 'Earth.jpg', folder: null },
    { name: 'Earthset.jpg', folder: null },
    { name: 'Saturn.jpg', folder: null },
    { name: 'map.png', folder: 'Trips' },
    { name: 'Day 2.jpg', folder: 'Trips/Rome' },
    { name: 'Day 10.jpg', folder: 'Trips/Rome' },
  ]

  it('files about to be shared come back top of the library first, then by folder, then by name', async () => {
    const ids = await addLibrary()
    const files = await offline().filesToShare(ids)
    expect(files.map((f) => ({ name: f.name, folder: f.folder }))).toEqual(ORDER)
  })

  it('files about to be shared come back in the same order whatever order the ids are in', async () => {
    const ids = await addLibrary()
    const forward = await offline().filesToShare(ids)
    const backward = await offline().filesToShare([...ids].reverse())
    expect(backward.map((f) => f.fileId)).toEqual(forward.map((f) => f.fileId))
  })

  it('a link lists its files in the same order as the files about to be shared, whatever order they were added in', async () => {
    const ids = await addLibrary()
    await insertShareLink(db(), {
      publicKey: 'ed25519:link',
      seed: '07'.repeat(32),
      indexerURL: INDEXER,
      createdAt: 1,
      expiresAt: null,
      mode: 'latest',
    })
    for (const id of ids) await insertShareLinkFile(db(), 'ed25519:link', id, 'shared')

    const shares = offline()
    const [link] = await shares.links()
    expect(link.files.map((f) => ({ name: f.name, folder: f.folder }))).toEqual(ORDER)
    expect(link.files.map((f) => f.fileId)).toEqual(
      (await shares.filesToShare(ids)).map((f) => f.fileId),
    )
  })

  it('a name starting past U+FFFF sorts after a full-width letter, as the library sorts it', async () => {
    await addFile('emoji', '\u{1F600}.jpg')
    await addFile('wide', '\uFF21.jpg')
    const files = await offline().filesToShare(['emoji', 'wide'])
    expect(files.map((f) => f.fileId)).toEqual(['wide', 'emoji'])
  })

  it('two folders whose names sort the same each keep their files together', async () => {
    const two = await insertDirectory(db(), 'Trips 2')
    const zeroTwo = await insertDirectory(db(), 'Trips 02')
    await addFile('two-a', 'a.jpg', two.id)
    await addFile('zero-two-b', 'b.jpg', zeroTwo.id)
    await addFile('two-c', 'c.jpg', two.id)
    const files = await offline().filesToShare(['two-a', 'zero-two-b', 'two-c'])
    expect(files.map((f) => [f.folder, f.name])).toEqual([
      ['Trips 02', 'b.jpg'],
      ['Trips 2', 'a.jpg'],
      ['Trips 2', 'c.jpg'],
    ])
  })
})
