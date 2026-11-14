/*
 * `thumbnails.read`, which the desktop app's windows use to draw a file's
 * thumbnail. Device A adds the files and generates their thumbnails. Device B
 * has only what sync brought down, so a thumbnail it reads comes from the
 * network.
 */
import { createEmptyIndexerStorage, type MockIndexerStorage } from '@siastorage/sdk-mock'
import { createTestApp, generateTestFiles, type TestApp, waitForCondition } from './app'

describe('reading a thumbnail for the app', () => {
  let shared: MockIndexerStorage
  let A: TestApp
  let B: TestApp

  beforeEach(async () => {
    shared = createEmptyIndexerStorage()
    const thumbnail = {
      async generateImageThumbnail(_source: string, size: number) {
        return {
          data: new TextEncoder().encode(`thumbnail at ${size}`).buffer as ArrayBuffer,
          mimeType: 'image/webp',
        }
      },
    }
    A = createTestApp(shared, { thumbnail })
    B = createTestApp(shared, { thumbnail })
    await A.start()
    await B.start()
  })

  afterEach(async () => {
    await A.shutdown()
    await B.shutdown()
  })

  it("reads another device's 64px thumbnail without downloading the file", async () => {
    const [photo] = await A.addFiles(generateTestFiles(1, { type: 'image' }))

    let image = await B.app.thumbnails.read(photo.id, 64)
    await waitForCondition(
      async () => {
        image = await B.app.thumbnails.read(photo.id, 64)
        return image !== null
      },
      { timeout: 30_000, message: 'the 64px thumbnail to reach B' },
    )

    expect(image?.mimeType).toBe('image/webp')
    expect(Buffer.from(image!.data, 'base64').toString()).toBe('thumbnail at 64')
    expect(await B.getFsFileUri({ id: photo.id, type: photo.type })).toBeNull()
  })

  it('reads null for a trashed file and leaves its thumbnail off the device', async () => {
    const [photo] = await A.addFiles(generateTestFiles(1, { type: 'image' }))
    let thumb = await B.app.thumbnails.getByFileIdAndSize(photo.id, 64)
    await waitForCondition(
      async () => {
        thumb = await B.app.thumbnails.getByFileIdAndSize(photo.id, 64)
        return thumb !== null
      },
      { timeout: 30_000, message: "the 64px thumbnail's row to reach B" },
    )

    await B.app.files.trashFile(photo.id)

    expect(await B.app.thumbnails.read(photo.id, 64)).toBeNull()
    expect(await B.getFsFileUri({ id: thumb!.id, type: thumb!.type })).toBeNull()
  })

  it('reads null for a file that has no thumbnail', async () => {
    const [data] = await A.addFiles(generateTestFiles(1, { type: 'data' }))
    await waitForCondition(async () => (await B.app.files.getById(data.id)) !== null, {
      timeout: 30_000,
      message: 'B to see the file',
    })

    expect(await B.app.thumbnails.read(data.id, 64)).toBeNull()
  })
})
