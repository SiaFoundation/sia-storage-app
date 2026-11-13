/*
 * A device with a mount: a folder a file manager shows, where the operating
 * system keeps its own copy of each file opened or created there.
 *
 * `mac` has one, stood in for by `createFakeFinder`, and `peer` is a second
 * device on the same account with none. The tests follow a file through both
 * places its bytes can be on the Mac, the cache and the mount, for every way
 * a file arrives: created in Finder, saved again, synced down from the peer,
 * read by ranges. The record under test is `mount_copies`, which says which
 * version of each file the mount holds, whole or in part.
 */
import { createHash } from 'node:crypto'
import * as nodeFs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { toContentHash } from '@siastorage/core/lib/contentHash'
import { createEmptyIndexerStorage, type MockIndexerStorage } from '@siastorage/sdk-mock'
import { createTestApp, type TestApp } from './app'
import { createFakeFinder, type FakeFinder } from './fakeFinder'
import { waitForCondition } from './utils'

const ONE_DAY = 24 * 60 * 60_000
const LONG_AGO = () => Date.now() - 30 * ONE_DAY
const sha = (bytes: Uint8Array) => toContentHash(createHash('sha256').update(bytes).digest('hex'))
const bytesOf = (label: string, size = 100) => Buffer.alloc(size, label)

describe('a device with a Finder folder', () => {
  let shared: MockIndexerStorage
  let mac: TestApp
  let peer: TestApp
  let finder: FakeFinder
  let macHandoff: string
  let peerHandoff: string

  beforeEach(async () => {
    shared = createEmptyIndexerStorage()
    macHandoff = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'finder-mount-mac-'))
    peerHandoff = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'finder-mount-peer-'))
    finder = createFakeFinder(macHandoff)
    mac = createTestApp(shared, { handoffDir: macHandoff, mount: finder.adapter })
    peer = createTestApp(shared, { handoffDir: peerHandoff })
    await mac.start()
    await peer.start()
    await finder.attach(mac)
  })

  afterEach(async () => {
    await mac.shutdown()
    await peer.shutdown()
    nodeFs.rmSync(macHandoff, { recursive: true, force: true })
    nodeFs.rmSync(peerHandoff, { recursive: true, force: true })
  })

  /** The id of the version a file's item shows now. */
  async function versionOf(device: TestApp, itemId: string): Promise<string> {
    const [fileId] = await device.app.provider.fileIds([itemId])
    if (!fileId) throw new Error(`no file behind item ${itemId}`)
    return fileId
  }

  const cached = async (fileId: string) => (await mac.app.fs.readMeta(fileId)) !== null
  const mountRow = (itemId: string) => mac.app.mountCopies.read(itemId)

  async function uploaded(device: TestApp, itemId: string, bytes?: Uint8Array): Promise<void> {
    await waitForCondition(
      async () => {
        const item = await device.app.provider.item(itemId)
        return !!item?.uploaded && (!bytes || item.contentVersion === sha(bytes))
      },
      { timeout: 30_000, message: `${itemId} to be uploaded` },
    )
  }

  /** Writes a file on the peer and waits for the Mac to list it, uploaded. */
  async function fromPeer(name: string, bytes: Buffer): Promise<string> {
    const staged = path.join(peerHandoff, `stage-${crypto.randomUUID()}`)
    nodeFs.writeFileSync(staged, bytes)
    const item = await peer.app.provider.create(null, name, 'file', staged)
    await uploaded(mac, item.id, bytes)
    return item.id
  }

  /** Creates a file in Finder and waits until it is uploaded. */
  async function inFinder(name: string, bytes: Buffer): Promise<{ id: string; fileId: string }> {
    const item = await finder.create(null, name, bytes)
    const fileId = await versionOf(mac, item.id)
    await uploaded(mac, item.id)
    return { id: item.id, fileId }
  }

  describe('where a file is kept', () => {
    it('records a file opened in Finder as held whole once the system lists it', async () => {
      const bytes = bytesOf('a')
      const id = await fromPeer('a.bin', bytes)

      expect(await finder.open(id)).toEqual(bytes)

      const fileId = await versionOf(mac, id)
      // The system can still give up on the fetch, so the file is not whole yet.
      expect(await mountRow(id)).toMatchObject({ fileId, whole: false })
      expect(await cached(fileId)).toBe(true)
      expect(await mac.app.cache.bytesOnDevice()).toBe(bytes.length)
      await mac.app.cache.evict()

      expect(await mountRow(id)).toMatchObject({ fileId, bytes: bytes.length, whole: true })
      expect((await mac.app.provider.item(id))?.downloaded).toBe(true)
      expect(await mac.app.cache.bytesOnDevice()).toBe(bytes.length)
    })

    it('records a file created in Finder as held whole, and counts it once though it is in both places', async () => {
      mac.setConnected(false)
      const item = await finder.create(null, 'b0.bin', bytesOf('b', 300))
      const fileId = await versionOf(mac, item.id)

      expect(item.uploaded).toBe(false)
      expect(await cached(fileId)).toBe(true)
      expect(await mountRow(item.id)).toMatchObject({ fileId, whole: true })
      expect(await mac.app.cache.bytesOnDevice()).toBe(300)
    })

    it('records nothing on a device with no mount', async () => {
      const bytes = bytesOf('d')
      const staged = path.join(macHandoff, 'stage-d')
      nodeFs.writeFileSync(staged, bytes)
      const item = await mac.app.provider.create(null, 'd.bin', 'file', staged)
      await uploaded(peer, item.id, bytes)
      const dest = path.join(peerHandoff, 'fetch-d')

      await peer.app.provider.fetch(item.id, dest)

      const fileId = await versionOf(peer, item.id)
      expect((await peer.app.fs.readMeta(fileId)) !== null).toBe(true)
      expect(await peer.app.mountCopies.read(item.id)).toBeNull()
    })

    it('forgets what a mount held once the mount is removed', async () => {
      const id = await fromPeer('e.bin', bytesOf('e'))
      await finder.open(id)
      await mac.app.cache.evict()
      expect(await mountRow(id)).not.toBeNull()

      await mac.app.settings.setMount(null)

      expect(await mountRow(id)).toBeNull()
      expect(await mac.app.settings.getMountCursor()).toBeNull()
    })
  })

  describe('versions', () => {
    it('keeps both versions in the cache when a file is saved again before it uploaded', async () => {
      mac.setConnected(false)
      const first = await finder.create(null, 'f.bin', bytesOf('1'))
      const firstId = await versionOf(mac, first.id)

      const second = await finder.save(first.id, bytesOf('2', 150))
      const secondId = await versionOf(mac, second.id)

      expect(second.id).toBe(first.id)
      expect(secondId).not.toBe(firstId)
      // Finder now holds only the second version's bytes, so the cache is
      // the only place the first version exists.
      expect(await cached(firstId)).toBe(true)
      expect(await cached(secondId)).toBe(true)
      expect(await mountRow(first.id)).toMatchObject({ fileId: secondId, bytes: 150 })
    })

    it('records the same version when a save changes nothing', async () => {
      const bytes = bytesOf('g')
      const { id, fileId } = await inFinder('g.bin', bytes)

      const saved = await finder.save(id, bytes)

      expect(saved.contentVersion).toBe(sha(bytes))
      expect(await versionOf(mac, id)).toBe(fileId)
      expect(await mountRow(id)).toMatchObject({ fileId, whole: true })
    })

    it("records another device's version once Finder has fetched it", async () => {
      const { id } = await inFinder('h.bin', bytesOf('1'))
      await uploaded(peer, id)
      const next = bytesOf('2', 180)
      const staged = path.join(peerHandoff, 'stage-h2')
      nodeFs.writeFileSync(staged, next)

      await peer.app.provider.write(id, staged)
      await uploaded(mac, id, next)
      // Until Finder fetches it, the Mac holds the old version and says so.
      const secondId = await versionOf(mac, id)
      expect((await mountRow(id))?.fileId).not.toBe(secondId)
      expect(await finder.followChanges()).toEqual([id])
      await mac.app.cache.evict()

      expect(finder.held.get(id)?.bytes).toEqual(next)
      expect(await mountRow(id)).toMatchObject({ fileId: secondId, bytes: 180, whole: true })
    })

    it('keeps one record, for the version shown, when a rename merges two files', async () => {
      await inFinder('kept.bin', bytesOf('k'))
      const moved = await inFinder('moved.bin', bytesOf('m', 130))

      const merged = await mac.app.provider.rename(moved.id, null, 'kept.bin')
      await mac.app.cache.evict()

      // One file is left, the renamed version is the one it shows, and the
      // record names that version under the id the file now has.
      expect(await mountRow(merged.id)).toMatchObject({ fileId: moved.fileId, bytes: 130 })
      expect(await mac.app.mountCopies.wholeStackIds()).toEqual([merged.id])
    })

    it('forgets a file trashed in Finder', async () => {
      const { id } = await inFinder('j.bin', bytesOf('j'))

      await finder.trash(id)

      expect(await mountRow(id)).toBeNull()
    })
  })

  describe('reading by ranges', () => {
    it('records what Finder read of a file, and calls it whole once the system says so', async () => {
      const bytes = bytesOf('r', 1000)
      const id = await fromPeer('r.bin', bytes)
      const fileId = await versionOf(mac, id)

      const first = await finder.readRange(id, 0, 400)

      expect(first.bytes).toEqual(bytes.subarray(0, 400))
      expect(await mountRow(id)).toMatchObject({ fileId, bytes: 400, whole: false })
      expect(await mac.app.cache.bytesOnDevice()).toBe(400)
      expect((await mac.app.provider.item(id))?.downloaded).toBe(false)

      await finder.readRange(id, 400, 600)
      // Every byte is in, but only the system can say it holds the file whole.
      expect(await mountRow(id)).toMatchObject({ fileId, bytes: 1000, whole: false })

      await mac.app.cache.evict()

      expect(await mountRow(id)).toMatchObject({ fileId, bytes: 1000, whole: true })
      expect((await mac.app.provider.item(id))?.downloaded).toBe(true)
      expect(await cached(fileId)).toBe(false)
    })
  })

  describe("following the system's own removals", () => {
    it('forgets a file the system dropped', async () => {
      const { id } = await inFinder('u.bin', bytesOf('u', 250))
      // The first read is a full one and saves the place to read changes from.
      await mac.app.cache.evict()
      expect(await mac.app.cache.bytesOnDevice()).toBe(250)

      await finder.drop(id)
      await mac.app.cache.evict()

      expect(await mountRow(id)).toBeNull()
    })

    it('keeps the record of a file Finder opened again after dropping it', async () => {
      const id = await fromPeer('w.bin', bytesOf('w'))
      await finder.open(id)
      await mac.app.cache.evict()

      await finder.drop(id)
      await finder.open(id)
      await mac.app.cache.evict()

      expect(await mountRow(id)).toMatchObject({ whole: true })
    })

    it("corrects the record from the system's full list", async () => {
      const taken = await inFinder('x1.bin', bytesOf('1'))
      const untracked = await inFinder('x2.bin', bytesOf('2', 120))
      // A file handed over that the system never took, and one it holds that
      // nothing recorded.
      finder.held.delete(taken.id)
      await mac.app.mountCopies.touch([taken.id], LONG_AGO())
      await mac.app.mountCopies.delete([untracked.id])
      await mac.app.settings.setMountCursor(null)

      await mac.app.cache.evict()

      expect(await mountRow(taken.id)).toBeNull()
      expect(await mountRow(untracked.id)).toMatchObject({ fileId: untracked.fileId, bytes: 120 })
    })

    it('takes the full list the system gives when it will not read changes from the saved place', async () => {
      const { id } = await inFinder('x3.bin', bytesOf('3'))
      await mac.app.cache.evict()
      finder.held.delete(id)
      await mac.app.mountCopies.touch([id], LONG_AGO())
      finder.expireCursor()

      await mac.app.cache.evict()

      expect(await mountRow(id)).toBeNull()
    })

    it('reads the full list again a day after the last one, though changes still read', async () => {
      const { id } = await inFinder('x4.bin', bytesOf('4'))
      await mac.app.cache.evict()
      // Gone with no change listed for it, which only a full list shows.
      finder.held.delete(id)
      await mac.app.mountCopies.touch([id], LONG_AGO())
      const saved = await mac.app.settings.getMountCursor()
      if (!saved) throw new Error('the first pass saved no cursor')
      await mac.app.settings.setMountCursor({ ...saved, fullAt: Date.now() - 2 * ONE_DAY })

      await mac.app.cache.evict()

      expect(await mountRow(id)).toBeNull()
    })
  })
})
