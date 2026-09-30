/*
 * A library can hold raw photos stored as TIFF: byte detection once typed a
 * DNG by the TIFF signature it begins with. The repair gives each the type its
 * name gives, moves a local copy with it, and the other device agrees. Each app
 * runs it once, after its first sync-down pass that reaches the end of the
 * network's events.
 */
import { createHash } from 'node:crypto'
import { toContentHash } from '@siastorage/core/lib/contentHash'
import { repairRawPhotoTypes } from '@siastorage/core/services/repairRawPhotoTypes'
import { createEmptyIndexerStorage, type MockIndexerStorage } from '@siastorage/sdk-mock'
import { createTestApp, type TestApp } from './app'
import { waitForCondition } from './utils'

const TIFF = new Uint8Array([0x49, 0x49, 0x2a, 0x00, ...new Array(60).fill(0)])

describe('Repairing raw photos stored as TIFF', () => {
  let shared: MockIndexerStorage
  let laptop: TestApp
  let phone: TestApp

  beforeEach(async () => {
    shared = createEmptyIndexerStorage()
    laptop = createTestApp(shared)
    phone = createTestApp(shared)
    await laptop.start()
    await phone.start()
    // The pass that syncs this photo down reaches the end of the events, so a
    // device holding it has run its one repair or runs it before its next
    // pass. A raw published after both hold it is left for an explicit call.
    publish('probe', 'probe.jpg', 'image/jpeg')
    await waitForCondition(
      async () =>
        (await typeOf(laptop, 'probe')) !== undefined &&
        (await typeOf(phone, 'probe')) !== undefined,
      { timeout: 15_000, message: 'both devices to catch up' },
    )
  })

  afterEach(async () => {
    await laptop.shutdown()
    await phone.shutdown()
  })

  function publish(
    id: string,
    name: string,
    type = 'image/tiff',
    updatedAt = Date.now(),
  ): Uint8Array<ArrayBuffer> {
    // The id goes into the bytes, so two versions of one name differ in content.
    const data = new Uint8Array([...TIFF, ...new TextEncoder().encode(id)])
    laptop.sdk.injectObject({
      metadata: {
        id,
        name,
        type,
        kind: 'file',
        size: data.length,
        hash: toContentHash(createHash('sha256').update(data).digest('hex')),
        createdAt: updatedAt,
        updatedAt,
        trashedAt: null,
      },
      data,
    })
    return data
  }

  const typeOf = async (app: TestApp, id: string) => (await app.getFileById(id))?.type

  it('gives each its raw type, moves a local copy with it, and the other device agrees', async () => {
    const held = publish('held', 'IMG_0001.DNG')
    publish('remote', 'IMG_0002.nef')
    await waitForCondition(
      async () =>
        (await typeOf(laptop, 'held')) !== undefined &&
        (await typeOf(laptop, 'remote')) !== undefined,
      { timeout: 15_000, message: 'the laptop to sync both photos down' },
    )
    await laptop.app.fs.writeFileData({ id: 'held', type: 'image/tiff' }, held.buffer)
    expect(await laptop.app.fs.readMeta('held')).toBeTruthy()

    expect(await repairRawPhotoTypes(laptop.app)).toBe(2)

    expect(await typeOf(laptop, 'held')).toBe('image/dng')
    expect(await typeOf(laptop, 'remote')).toBe('image/x-nikon-nef')
    expect(await laptop.app.fs.getFileUri({ id: 'held', type: 'image/dng' })).toBeTruthy()
    await waitForCondition(
      async () =>
        (await typeOf(phone, 'held')) === 'image/dng' &&
        (await typeOf(phone, 'remote')) === 'image/x-nikon-nef',
      { timeout: 20_000, message: 'the phone to receive the repaired types' },
    )
    expect(await repairRawPhotoTypes(laptop.app)).toBe(0)
  }, 45_000)

  it('a device started after the photo was published repairs it without a call, and the others receive the raw type', async () => {
    publish('legacy', 'IMG_0003.DNG')
    await waitForCondition(async () => (await typeOf(laptop, 'legacy')) !== undefined, {
      timeout: 15_000,
      message: 'the laptop to sync the photo down',
    })
    expect(await typeOf(laptop, 'legacy')).toBe('image/tiff')

    const desk = createTestApp(shared)
    await desk.start()
    try {
      await waitForCondition(async () => (await typeOf(desk, 'legacy')) === 'image/dng', {
        timeout: 15_000,
        message: 'the desk to repair the photo',
      })
      await waitForCondition(
        async () =>
          (await typeOf(laptop, 'legacy')) === 'image/dng' &&
          (await typeOf(phone, 'legacy')) === 'image/dng',
        { timeout: 20_000, message: 'the laptop and the phone to receive the raw type' },
      )
    } finally {
      await desk.shutdown()
    }
  }, 45_000)

  it('keeps the newest version current when an older version of the photo is repaired too', async () => {
    // The older version reaches the laptop last, so it is repaired last. A
    // repair stamped as an edit would make it the newest.
    const now = Date.now()
    publish('newer', 'IMG_0004.DNG', 'image/tiff', now)
    await waitForCondition(async () => (await typeOf(laptop, 'newer')) !== undefined, {
      timeout: 15_000,
      message: 'the laptop to sync the newer version down',
    })
    publish('older', 'IMG_0004.DNG', 'image/tiff', now - 60_000)
    await waitForCondition(async () => (await typeOf(laptop, 'older')) !== undefined, {
      timeout: 15_000,
      message: 'the laptop to sync the older version down',
    })
    expect((await laptop.app.files.getByName('IMG_0004.DNG'))?.id).toBe('newer')

    expect(await repairRawPhotoTypes(laptop.app)).toBe(2)

    expect(await typeOf(laptop, 'older')).toBe('image/dng')
    expect((await laptop.app.files.getByName('IMG_0004.DNG'))?.id).toBe('newer')
    expect((await laptop.getFileById('older'))?.updatedAt).toBe(now - 60_000)
  }, 45_000)

  it('leaves a TIFF named as a TIFF alone', async () => {
    publish('scan', 'scan.tiff')
    await waitForCondition(async () => (await typeOf(laptop, 'scan')) !== undefined, {
      timeout: 15_000,
      message: 'the laptop to sync the scan down',
    })
    expect(await repairRawPhotoTypes(laptop.app)).toBe(0)
    expect(await typeOf(laptop, 'scan')).toBe('image/tiff')
  }, 30_000)
})
