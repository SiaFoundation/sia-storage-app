/*
 * Finder's thumbnails for files that are not on this device. Device A holds
 * the files and generates their thumbnails. Device B is the Mac: it has only
 * what sync brought down, and `provider.thumbnail` is what its File Provider
 * extension asks for each icon on screen.
 *
 * A's thumbnail generator is held until a test releases it, so a test can see
 * B before and after the thumbnail syncs, and each thumbnail it writes names
 * the source file it came from, so a test can tell one version's from
 * another's.
 */
import * as nodeFs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createEmptyIndexerStorage, type MockIndexerStorage } from '@siastorage/sdk-mock'
import { createTestApp, type TestApp, waitForCondition } from './app'

/** How long B holds a request for a thumbnail that has not synced. */
const THUMBNAIL_WAIT_MS = 10_000

describe('Finder thumbnails for files not on this device', () => {
  let shared: MockIndexerStorage
  let A: TestApp
  let B: TestApp
  let handoff: string
  let staged = 0
  /** Numbers each source file in the order A first generates for it. */
  let sources: Map<string, number>
  let release: () => void = () => {}
  let held: Promise<void>

  function holdGenerator() {
    held = new Promise((resolve) => {
      release = resolve
    })
  }

  beforeEach(async () => {
    shared = createEmptyIndexerStorage()
    handoff = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'provider-thumbs-'))
    holdGenerator()
    sources = new Map()
    A = createTestApp(shared, {
      handoffDir: handoff,
      thumbnail: {
        async generateImageThumbnail(source: string, size: number) {
          await held
          if (!sources.has(source)) sources.set(source, sources.size + 1)
          return {
            data: new TextEncoder().encode(`version ${sources.get(source)} at ${size}`)
              .buffer as ArrayBuffer,
            mimeType: 'image/webp',
          }
        },
      },
    })
    B = createTestApp(shared, {
      handoffDir: handoff,
      thumbnailWaitMs: THUMBNAIL_WAIT_MS,
      thumbnailRetryBackoffMs: 0,
    })
    await A.start()
    await B.start()
  })

  afterEach(async () => {
    release()
    await A.shutdown()
    await B.shutdown()
    nodeFs.rmSync(handoff, { recursive: true, force: true })
  })

  function stage(bytes: string): string {
    const file = path.join(handoff, `staged-${++staged}`)
    nodeFs.writeFileSync(file, bytes)
    return file
  }

  async function seenOnB(id: string, contentVersion?: string) {
    await waitForCondition(
      async () => {
        const item = await B.app.provider.item(id)
        return (
          item !== null && (contentVersion === undefined || item.contentVersion === contentVersion)
        )
      },
      { timeout: 30_000, message: `B to see ${id}` },
    )
  }

  async function thumbnailText(device: TestApp, id: string): Promise<string | null> {
    try {
      const answer = await device.app.provider.thumbnail(id)
      return answer.kind === 'image' ? Buffer.from(answer.data, 'base64').toString() : 'none'
    } catch {
      return null
    }
  }

  async function bIsLocal(id: string): Promise<boolean> {
    return (await B.app.provider.item(id))?.downloaded ?? false
  }

  it('serves the 512px thumbnail from another device without downloading the file', async () => {
    release()
    const created = await A.app.provider.create(null, 'photo.jpg', 'file', stage('pixels'))
    await seenOnB(created.id)

    expect(await thumbnailText(B, created.id)).toBe('version 1 at 512')
    expect(await bIsLocal(created.id)).toBe(false)
  })

  it('answers "none" for a file that can never have a thumbnail', async () => {
    const created = await A.app.provider.create(null, 'notes.txt', 'file', stage('words'))
    await seenOnB(created.id)

    expect(await B.app.provider.thumbnail(created.id)).toEqual({ kind: 'none' })
  })

  it('holds the request for a new file until its thumbnail syncs, rather than failing', async () => {
    const created = await A.app.provider.create(null, 'photo.jpg', 'file', stage('pixels'))
    await seenOnB(created.id)

    const answer = thumbnailText(B, created.id)
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    release()

    expect(await answer).toBe('version 1 at 512')
  })

  it('answers an error once the wait ends with no thumbnail', async () => {
    const created = await A.app.provider.create(null, 'photo.jpg', 'file', stage('pixels'))
    await seenOnB(created.id)

    const started = Date.now()
    await expect(B.app.provider.thumbnail(created.id)).rejects.toThrow(/No thumbnail yet/)
    expect(Date.now() - started).toBeGreaterThanOrEqual(THUMBNAIL_WAIT_MS)
  }, 30_000)

  it('retries a thumbnail download that failed, and moves the date Finder watches once it lands', async () => {
    release()
    const created = await A.app.provider.create(null, 'photo.jpg', 'file', stage('pixels'))
    await seenOnB(created.id)
    await waitForCondition(
      async () => {
        const [fileId] = await B.app.provider.fileIds([created.id])
        return (await B.app.thumbnails.getByFileIdAndSize(fileId, 512)) !== null
      },
      { timeout: 30_000, message: 'B to sync the thumbnail row' },
    )
    const offline = jest
      .spyOn(B.sdk, 'downloadByObjectId')
      .mockRejectedValue(new Error('network is down'))
    const before = (await B.app.provider.item(created.id))!

    await expect(B.app.provider.thumbnail(created.id)).rejects.toThrow(/did not download/)
    offline.mockRestore()
    await B.app.provider.retryThumbnails()

    const after = (await B.app.provider.item(created.id))!
    expect(after.modifiedAt).toBe(before.modifiedAt + 1000)
    expect(after.metadataVersion).not.toBe(before.metadataVersion)
    expect(after.downloaded).toBe(false)
    expect(await thumbnailText(B, created.id)).toBe('version 1 at 512')
  })

  async function thumbnailRowSynced(device: TestApp, id: string) {
    await waitForCondition(
      async () => {
        const [fileId] = await device.app.provider.fileIds([id])
        return (await device.app.thumbnails.getByFileIdAndSize(fileId, 512)) !== null
      },
      { timeout: 30_000, message: 'the thumbnail row to sync' },
    )
  }

  it('signals the change feed when a thumbnail download finishes', async () => {
    release()
    const created = await A.app.provider.create(null, 'photo.jpg', 'file', stage('pixels'))
    await seenOnB(created.id)
    await thumbnailRowSynced(B, created.id)
    const signalled = jest.spyOn(B.app.caches.libraryVersion, 'invalidate')

    expect(await thumbnailText(B, created.id)).toBe('version 1 at 512')

    expect(signalled).toHaveBeenCalled()
  })

  it('keeps the retry list across a restart, so the retry still runs', async () => {
    release()
    const created = await A.app.provider.create(null, 'photo.jpg', 'file', stage('pixels'))
    await seenOnB(created.id)
    await thumbnailRowSynced(B, created.id)
    const offline = jest
      .spyOn(B.sdk, 'downloadByObjectId')
      .mockRejectedValue(new Error('network is down'))
    await expect(B.app.provider.thumbnail(created.id)).rejects.toThrow(/did not download/)
    offline.mockRestore()
    let saved: string | null = null
    await waitForCondition(
      async () => (saved = await B.app.storage.getItem('providerThumbnailRetries')) !== null,
      { timeout: 5_000, message: 'B to save its retry list' },
    )

    // A fresh device given B's saved storage stands in for B after a restart.
    const restarted = createTestApp(shared, { handoffDir: handoff })
    await restarted.start()
    try {
      await waitForCondition(async () => (await restarted.app.provider.item(created.id)) !== null, {
        timeout: 30_000,
        message: 'the restarted device to see the file',
      })
      await thumbnailRowSynced(restarted, created.id)
      await restarted.app.storage.setItem('providerThumbnailRetries', saved!)
      const before = (await restarted.app.provider.item(created.id))!

      await restarted.app.provider.retryThumbnails()

      const after = (await restarted.app.provider.item(created.id))!
      expect(after.modifiedAt).toBe(before.modifiedAt + 1000)
    } finally {
      await restarted.shutdown()
    }
  })

  it('keeps retrying a thumbnail that syncs late, however many passes it takes', async () => {
    const created = await A.app.provider.create(null, 'photo.jpg', 'file', stage('pixels'))
    await seenOnB(created.id)
    await expect(B.app.provider.thumbnail(created.id)).rejects.toThrow(/No thumbnail yet/)
    for (let pass = 0; pass < 30; pass++) await B.app.provider.retryThumbnails()
    const before = (await B.app.provider.item(created.id))!

    release()
    await thumbnailRowSynced(B, created.id)
    await B.app.provider.retryThumbnails()

    const after = (await B.app.provider.item(created.id))!
    expect(after.modifiedAt).toBe(before.modifiedAt + 1000)
    expect(await thumbnailText(B, created.id)).toBe('version 1 at 512')
  }, 30_000)

  it('stops waiting on a stalled retry once its signal aborts', async () => {
    release()
    const created = await A.app.provider.create(null, 'photo.jpg', 'file', stage('pixels'))
    await seenOnB(created.id)
    await thumbnailRowSynced(B, created.id)
    const offline = jest
      .spyOn(B.sdk, 'downloadByObjectId')
      .mockRejectedValue(new Error('network is down'))
    await expect(B.app.provider.thumbnail(created.id)).rejects.toThrow(/did not download/)
    let unblock: (e: Error) => void = () => {}
    offline.mockImplementation(
      () =>
        new Promise((_, reject) => {
          unblock = reject
        }),
    )
    const controller = new AbortController()

    const retry = B.app.provider.retryThumbnails(controller.signal)
    setTimeout(() => controller.abort(), 200)

    const started = Date.now()
    await retry
    expect(Date.now() - started).toBeLessThan(2_000)
    unblock(new Error('network is down'))
    offline.mockRestore()
  })

  it("serves the new version's thumbnail after an edit, never the old one's", async () => {
    release()
    const created = await A.app.provider.create(null, 'photo.jpg', 'file', stage('pixels'))
    await seenOnB(created.id)
    expect(await thumbnailText(B, created.id)).toBe('version 1 at 512')

    holdGenerator()
    const edited = await A.app.provider.write(created.id, stage('new pixels'))
    await seenOnB(created.id, edited.contentVersion)
    const answer = thumbnailText(B, created.id)
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    release()

    expect(await answer).toBe('version 2 at 512')
  })
})
