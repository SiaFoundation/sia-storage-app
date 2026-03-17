import type { FlushRecord } from '@siastorage/core/services/uploader'
import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import { createTestApp, generateTestFiles, type TestApp } from './app'

describe('Upload Packing', () => {
  let app: TestApp

  beforeEach(async () => {
    app = createTestApp(createEmptyIndexerStorage())
    await app.start()
  })

  afterEach(async () => {
    await app.shutdown()
  })

  function getFlushHistory(): FlushRecord[] {
    return app.uploadManager.flushHistory
  }

  it('complex multi-wave scenario across many slabs and flushes', async () => {
    const wave1 = generateTestFiles(40, { startId: 1, sizeBytes: 200 })
    await app.addFiles(wave1)

    const wave2 = generateTestFiles(20, { startId: 100, sizeBytes: 2000 })
    await app.addFiles(wave2)

    const wave3 = generateTestFiles(10, { startId: 200, sizeBytes: 8000 })
    await app.addFiles(wave3)

    const wave4 = generateTestFiles(30, { startId: 300, sizeBytes: 100 })
    await app.addFiles(wave4)

    await app.waitForNoActiveUploads(120_000)

    const history = getFlushHistory()

    expect(history).toHaveLength(8)

    expect(history[0]).toMatchObject({
      reason: 'slab_threshold',
      fileCount: 41,
      slabsFilled: 0,
      fillPercent: 98,
    })

    for (let i = 1; i <= 3; i++) {
      expect(history[i]).toMatchObject({
        reason: 'slab_threshold',
        fileCount: 5,
        slabsFilled: 0,
        fillPercent: 98,
      })
    }

    expect(history[4]).toMatchObject({
      reason: 'slab_threshold',
      fileCount: 8,
      slabsFilled: 3,
      fillPercent: 98,
    })

    expect(history[5]).toMatchObject({
      reason: 'slab_threshold',
      fileCount: 5,
      slabsFilled: 3,
      fillPercent: 98,
    })

    expect(history[6]).toMatchObject({
      reason: 'slab_threshold',
      fileCount: 23,
      slabsFilled: 0,
      fillPercent: 100,
    })

    expect(history[7]).toMatchObject({
      reason: 'idle_timeout',
      fileCount: 8,
      slabsFilled: 0,
      fillPercent: 8,
    })

    const totalFiles = history.reduce((sum, h) => sum + h.fileCount, 0)
    expect(totalFiles).toBe(100)
    expect(app.sdk.getStoredObjects()).toHaveLength(100)
  }, 120_000)

  it('files arriving in waves — all packed before flush', async () => {
    const wave1 = generateTestFiles(3, { startId: 1, sizeBytes: 500 })
    await app.addFiles(wave1)

    await new Promise((r) => setTimeout(r, 500))

    const wave2 = generateTestFiles(3, { startId: 10, sizeBytes: 500 })
    await app.addFiles(wave2)

    await app.waitForNoActiveUploads(30_000)

    const history = getFlushHistory()

    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      reason: 'idle_timeout',
      fileCount: 6,
      slabsFilled: 0,
      fillPercent: 29,
    })

    expect(app.sdk.getStoredObjects()).toHaveLength(6)
  }, 60_000)

  it('steady stream of mixed sizes across many flush cycles', async () => {
    const thumbs = generateTestFiles(100, { startId: 1, sizeBytes: 50 })
    await app.addFiles(thumbs)

    const photos = generateTestFiles(30, { startId: 200, sizeBytes: 3000 })
    await app.addFiles(photos)

    const videos = generateTestFiles(5, { startId: 400, sizeBytes: 9000 })
    await app.addFiles(videos)

    const moreThumb = generateTestFiles(50, { startId: 500, sizeBytes: 50 })
    await app.addFiles(moreThumb)

    await app.waitForNoActiveUploads(120_000)

    const history = getFlushHistory()

    expect(history).toHaveLength(6)

    expect(history[0]).toMatchObject({
      reason: 'slab_threshold',
      fileCount: 105,
      slabsFilled: 1,
      fillPercent: 98,
    })

    expect(history[1]).toMatchObject({
      reason: 'slab_threshold',
      fileCount: 10,
      slabsFilled: 2,
      fillPercent: 98,
    })

    expect(history[2]).toMatchObject({
      reason: 'slab_threshold',
      fileCount: 10,
      slabsFilled: 2,
      fillPercent: 98,
    })

    expect(history[3]).toMatchObject({
      reason: 'slab_threshold',
      fileCount: 9,
      slabsFilled: 4,
      fillPercent: 100,
    })

    expect(history[4]).toMatchObject({
      reason: 'slab_threshold',
      fileCount: 25,
      slabsFilled: 0,
      fillPercent: 100,
    })

    expect(history[5]).toMatchObject({
      reason: 'idle_timeout',
      fileCount: 26,
      slabsFilled: 0,
      fillPercent: 13,
    })

    const totalFiles = history.reduce((sum, h) => sum + h.fileCount, 0)
    expect(totalFiles).toBe(185)
    expect(app.sdk.getStoredObjects()).toHaveLength(185)
  }, 120_000)
})
