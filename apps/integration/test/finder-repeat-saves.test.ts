import * as nodeFs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createEmptyIndexerStorage, type MockIndexerStorage } from '@siastorage/sdk-mock'
import { createTestApp } from './app'

/*
 * A Finder save made moments after the previous save of the same file waits
 * to upload, so the next save can replace it before it is sent. The
 * integration setup sets the quiet period to 3s and the cap to 9s.
 */
const QUIET = 3000

describe('Repeated Finder saves of one file', () => {
  let storage: MockIndexerStorage
  let handoff: string
  let mac: ReturnType<typeof createTestApp>
  let staged = 0
  const stage = (text: string) => {
    const file = path.join(handoff, `staged-${++staged}`)
    nodeFs.writeFileSync(file, text)
    return file
  }

  beforeEach(async () => {
    storage = createEmptyIndexerStorage()
    handoff = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'finder-repeat-saves-'))
    mac = createTestApp(storage, { handoffDir: handoff })
    await mac.start()
  })

  afterEach(async () => {
    await mac.shutdown()
    nodeFs.rmSync(handoff, { recursive: true, force: true })
  })

  async function versionIds(name = 'notes.txt', device = mac): Promise<string[]> {
    return (await device.app.files.getVersionHistory(name, null)).map((v) => v.id)
  }

  async function uploaded(id: string, device = mac): Promise<boolean> {
    return (await device.readLocalObjectsForFile(id)).length > 0
  }

  /**
   * notes.txt created and uploaded, then saved once, which uploads at once.
   * Returns the created version and the save, which is packed by then.
   */
  async function createAndSaveOnce(): Promise<[string, string]> {
    const created = await mac.app.provider.create(null, 'notes.txt', 'file', stage('created'))
    await mac.waitForCondition(() => uploaded(created.id), 30_000)
    const savedAt = Date.now()
    await mac.app.provider.write(created.id, stage('save 1'))
    const [first] = await versionIds()
    await mac.waitForCondition(() => mac.getUploadState(first)?.status !== 'queued', 30_000)
    // The burst that follows has to start within the quiet period of this save.
    expect(Date.now() - savedAt).toBeLessThan(QUIET)
    return [created.id, first]
  }

  it('uploads the last of a burst of saves once the saves stop, and none of those before it', async () => {
    const [created, first] = await createAndSaveOnce()

    for (let i = 2; i <= 10; i++) await mac.app.provider.write(created, stage(`save ${i}`))
    const [last] = await versionIds()
    expect(mac.getUploadState(last)).toBeUndefined()

    await mac.waitForCondition(() => uploaded(last), 30_000)
    expect(await versionIds()).toEqual([last, first, created])
    expect(storage.objects.size).toBe(3)
  }, 60_000)

  it('uploads a held save as soon as a share link names it', async () => {
    const [created] = await createAndSaveOnce()
    await mac.app.provider.write(created, stage('save 2'))
    const [held] = await versionIds()
    const enqueue = jest.spyOn(mac.app.uploader, 'enqueueByIds')

    await mac.app.shares.createLink([held], { expiresAt: null, mode: 'snapshot' })

    expect(enqueue).toHaveBeenCalledWith([held])
    await mac.waitForCondition(() => uploaded(held), 30_000)
  }, 60_000)

  it('uploads a held save as soon as it is added to an existing share link', async () => {
    const other = await mac.app.provider.create(null, 'other.txt', 'file', stage('other'))
    await mac.waitForCondition(() => uploaded(other.id), 30_000)
    const link = await mac.app.shares.createLink([other.id], { expiresAt: null, mode: 'latest' })
    const [created] = await createAndSaveOnce()
    await mac.app.provider.write(created, stage('save 2'))
    const [held] = await versionIds()
    const enqueue = jest.spyOn(mac.app.uploader, 'enqueueByIds')

    await mac.app.shares.addLinkFiles(link.publicKey, [held])

    expect(enqueue).toHaveBeenCalledWith([held])
  }, 60_000)

  it('keeps the thumbnails of a held save out of every batch', async () => {
    const photos = createTestApp(storage, { handoffDir: handoff, thumbnail: {} })
    const added: string[] = []
    storage.beforeAdd = async (p) => {
      added.push(p)
    }
    await photos.start()
    try {
      const created = await photos.app.provider.create(null, 'photo.jpg', 'file', stage('p0'))
      await photos.waitForCondition(() => uploaded(created.id, photos), 30_000)
      await photos.app.provider.write(created.id, stage('p1'))
      await photos.app.provider.write(created.id, stage('p2'))
      const [held] = await versionIds('photo.jpg', photos)
      // Long enough for the thumbnail scanner and an upload poll, each on a
      // one-second interval, and short of the quiet period that releases it.
      await new Promise((resolve) => setTimeout(resolve, QUIET - 1000))
      const thumbs = (await photos.readThumbnailsByFileId(held)).map((t) => t.id)
      expect(thumbs.length).toBeGreaterThan(0)

      await photos.app.provider.write(created.id, stage('p3'))

      const [last, ...older] = await versionIds('photo.jpg', photos)
      expect(older).not.toContain(held)
      await photos.waitForCondition(() => uploaded(last, photos), 30_000)
      expect(added.filter((p) => thumbs.some((id) => p.includes(id)))).toEqual([])
    } finally {
      storage.beforeAdd = null
      await photos.shutdown()
    }
  }, 60_000)

  it('uploads a held save at once after the uploader restarts', async () => {
    const [created] = await createAndSaveOnce()
    await mac.app.provider.write(created, stage('save 2'))
    const [held] = await versionIds()

    await mac.app.uploader.shutdown()
    mac.internal.initUploader()

    await mac.waitForCondition(() => mac.getUploadState(held) !== undefined, QUIET - 500)
    await mac.waitForCondition(() => uploaded(held), 30_000)
  }, 60_000)
})
