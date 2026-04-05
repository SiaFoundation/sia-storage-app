/**
 * Tests the suspension coordination protocol: scheduler pause/drain,
 * upload manager suspend/resume, and DB close/reopen. The test harness
 * mirrors the mobile lifecycle but is independent of suspension.ts —
 * these verify the building blocks, not the mobile orchestration.
 */
import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import { createTestApp, generateTestFiles, sleep, type TestApp, waitForCondition } from './app'

describe('Suspension', () => {
  let app: TestApp

  beforeEach(async () => {
    app = createTestApp(createEmptyIndexerStorage())
    await app.start()
  })

  afterEach(async () => {
    if (app.isSuspended()) {
      await app.resumeFromSuspension()
    }
    await app.shutdown()
  })

  it('suspend and resume during idle', async () => {
    await app.addFiles(generateTestFiles(3, { startId: 1 }))
    await app.waitForNoActiveUploads()
    expect(app.sdk.getStoredObjects().length).toBe(3)

    await app.suspend()
    expect(app.isSuspended()).toBe(true)
    expect(app.uploadManager.isSuspended).toBe(true)

    await sleep(1000)

    await app.resumeFromSuspension()
    expect(app.isSuspended()).toBe(false)
    expect(app.uploadManager.isSuspended).toBe(false)

    await app.addFiles(generateTestFiles(3, { startId: 100 }))
    await app.waitForNoActiveUploads()
    expect(app.sdk.getStoredObjects().length).toBe(6)
  }, 60_000)

  it('suspend freezes in-flight uploads and resume continues them', async () => {
    await app.addFiles(generateTestFiles(10, { startId: 1 }))

    await waitForCondition(
      () => {
        const uploads = app.app.uploads.getState().uploads
        return Object.values(uploads).some((u) => u.status === 'packing' || u.status === 'packed')
      },
      { timeout: 10_000, message: 'At least one file packing' },
    )

    await app.suspend()
    expect(app.uploadManager.isSuspended).toBe(true)

    const countAtSuspend = app.getActiveUploadCount()

    await sleep(2000)

    const countAfterWait = app.getActiveUploadCount()
    expect(countAfterWait).toBe(countAtSuspend)

    await app.resumeFromSuspension()
    await app.waitForNoActiveUploads()
    expect(app.sdk.getStoredObjects().length).toBe(10)
  }, 60_000)

  it('suspend during sync-down batch', async () => {
    const now = Date.now()
    for (let i = 0; i < 20; i++) {
      app.sdk.injectObject({
        metadata: {
          id: `file-${i}`,
          name: `photo-${i}.jpg`,
          type: 'image/jpeg',
          kind: 'file',
          size: 1024,
          hash: `hash-${i}`,
          createdAt: now - i * 1000,
          updatedAt: now - i * 1000,
          trashedAt: null,
        },
      })
    }

    // Wait for sync to start processing but not finish all objects
    app.triggerSyncDown()
    await waitForCondition(async () => (await app.getFiles()).length > 0, {
      timeout: 10_000,
      message: 'At least one file synced',
    })

    await app.suspend()
    await app.resumeFromSuspension()
    await app.waitForFileCount(20, 30_000)
    expect((await app.getFiles()).length).toBe(20)
  }, 60_000)

  it('rapid suspend/resume cycles', async () => {
    await app.addFiles(generateTestFiles(5, { startId: 1 }))

    // Wait for uploads to be in-flight before cycling
    await waitForCondition(
      () => {
        const uploads = app.app.uploads.getState().uploads
        return Object.values(uploads).some((u) => u.status === 'packing' || u.status === 'packed')
      },
      { timeout: 10_000, message: 'At least one file packing' },
    )

    for (let i = 0; i < 5; i++) {
      await app.suspend()
      await app.resumeFromSuspension()
    }

    await app.waitForNoActiveUploads()
    expect(app.sdk.getStoredObjects().length).toBe(5)
  }, 60_000)

  it('suspend preserves packer batch state', async () => {
    const files1 = await app.addFiles(generateTestFiles(1, { startId: 1, sizeBytes: 100 }))

    await app.waitForCondition(() => {
      const entry = app.app.uploads.getEntry(files1[0].id)
      return entry?.status === 'packed'
    })

    const flushCountBefore = app.uploadManager.flushHistory.length
    expect(flushCountBefore).toBe(0)

    await app.suspend()
    await app.resumeFromSuspension()

    const files2 = await app.addFiles(generateTestFiles(1, { startId: 2, sizeBytes: 100 }))

    await app.waitForCondition(() => {
      const entry = app.app.uploads.getEntry(files2[0].id)
      return entry?.status === 'packed'
    })

    expect(app.uploadManager.flushHistory.length).toBe(0)

    await app.waitForNoActiveUploads()
    expect(app.uploadManager.flushHistory.length).toBe(1)

    const flush = app.uploadManager.flushHistory[0]
    expect(flush.fileCount).toBe(2)
  }, 60_000)

  it('suspend with no services running', async () => {
    await app.suspend()
    expect(app.isSuspended()).toBe(true)

    await app.resumeFromSuspension()
    expect(app.isSuspended()).toBe(false)

    await app.addFiles(generateTestFiles(2, { startId: 1 }))
    await app.waitForNoActiveUploads()
    expect(app.sdk.getStoredObjects().length).toBe(2)
  }, 30_000)

  it('suspend during multi-device sync', async () => {
    const shared = createEmptyIndexerStorage()
    const deviceA = createTestApp(shared)
    const deviceB = createTestApp(shared)
    await deviceA.start()
    await deviceB.start()

    try {
      await deviceA.addFiles(generateTestFiles(5, { startId: 1 }))
      await deviceA.waitForNoActiveUploads()
      expect(deviceA.sdk.getStoredObjects().length).toBe(5)

      deviceB.triggerSyncDown()
      await sleep(100)
      await deviceB.suspend()

      await deviceB.resumeFromSuspension()
      await deviceB.waitForFileCount(5, 30_000)
      expect((await deviceB.getFiles()).length).toBe(5)
    } finally {
      if (deviceB.isSuspended()) await deviceB.resumeFromSuspension()
      await deviceA.shutdown()
      await deviceB.shutdown()
    }
  }, 60_000)

  it('background task resumes from suspension', async () => {
    await app.addFiles(generateTestFiles(3, { startId: 1 }))
    await app.waitForNoActiveUploads()

    await app.suspend()
    expect(app.isSuspended()).toBe(true)

    await app.resumeFromSuspension()
    await app.addFiles(generateTestFiles(2, { startId: 100 }))
    await app.waitForNoActiveUploads()
    expect(app.sdk.getStoredObjects().length).toBe(5)

    await app.suspend()
    expect(app.isSuspended()).toBe(true)

    await app.resumeFromSuspension()
    expect(app.isSuspended()).toBe(false)
    expect(app.areServicesRunning()).toBe(true)
  }, 60_000)

  it('foreground while background task has DB open', async () => {
    await app.addFiles(generateTestFiles(5, { startId: 1 }))
    await app.waitForNoActiveUploads()

    await app.suspend()
    expect(app.isSuspended()).toBe(true)

    await app.resumeFromSuspension()
    expect(app.isSuspended()).toBe(false)

    await app.addFiles(generateTestFiles(3, { startId: 100 }))

    await app.resumeFromSuspension()
    expect(app.isSuspended()).toBe(false)
    expect(app.areServicesRunning()).toBe(true)

    await app.waitForNoActiveUploads()
    expect(app.sdk.getStoredObjects().length).toBe(8)
  }, 60_000)

  it('background task finishes and re-suspends then user opens app', async () => {
    await app.suspend()

    await app.resumeFromSuspension()
    await app.addFiles(generateTestFiles(3, { startId: 1 }))
    await app.waitForNoActiveUploads()
    await app.suspend()

    expect(app.isSuspended()).toBe(true)
    expect(app.sdk.getStoredObjects().length).toBe(3)

    await app.resumeFromSuspension()
    expect(app.isSuspended()).toBe(false)

    await app.addFiles(generateTestFiles(2, { startId: 100 }))
    await app.waitForNoActiveUploads()
    expect(app.sdk.getStoredObjects().length).toBe(5)
  }, 60_000)

  it('multiple background tasks overlap with foreground', async () => {
    await app.suspend()

    await app.resumeFromSuspension()
    await app.addFiles(generateTestFiles(3, { startId: 1 }))

    await app.resumeFromSuspension()

    await app.addFiles(generateTestFiles(2, { startId: 100 }))

    await app.waitForNoActiveUploads()
    expect(app.sdk.getStoredObjects().length).toBe(5)
    expect(app.isSuspended()).toBe(false)
    expect(app.areServicesRunning()).toBe(true)
  }, 60_000)

  it('resume during in-flight suspension waits then resumes', async () => {
    await app.addFiles(generateTestFiles(5, { startId: 1 }))

    await waitForCondition(
      () => {
        const uploads = app.app.uploads.getState().uploads
        return Object.values(uploads).some((u) => u.status === 'packing' || u.status === 'packed')
      },
      { timeout: 10_000, message: 'At least one file packing' },
    )

    // Fire suspend WITHOUT await — simulates AppState callback
    const suspendPromise = app.suspend()

    // Immediately resume — simulates user switching back before suspension completes
    await app.resumeFromSuspension()

    // Should be fully resumed
    expect(app.isSuspended()).toBe(false)
    expect(app.areServicesRunning()).toBe(true)

    await suspendPromise

    // All files should still upload successfully
    await app.waitForNoActiveUploads()
    expect(app.sdk.getStoredObjects().length).toBe(5)
  }, 60_000)

  it('background task ending while foregrounded does not suspend', async () => {
    // Simulate: app backgrounded → suspended → background task starts
    app.isBackground = true
    await app.suspend()
    expect(app.isSuspended()).toBe(true)

    // Background task resumes the DB to do work
    await app.resumeFromSuspension()
    await app.addFiles(generateTestFiles(3, { startId: 1 }))
    await app.waitForNoActiveUploads()

    // User opens the app while background task is still "running"
    app.isBackground = false
    await app.resumeFromSuspension()

    // Background task ends — calls suspendIfBackground
    // Since app is foregrounded, this should be a no-op
    await app.suspendIfBackground()

    expect(app.isSuspended()).toBe(false)
    expect(app.areServicesRunning()).toBe(true)

    // App should still work normally
    await app.addFiles(generateTestFiles(2, { startId: 100 }))
    await app.waitForNoActiveUploads()
    expect(app.sdk.getStoredObjects().length).toBe(5)
  }, 60_000)
})
