/**
 * Tests the suspension coordination protocol using the shared
 * createSuspensionManager from core. The test harness and mobile both
 * use the same orchestration code — these tests exercise the real
 * phase ordering with real services, uploads, and DB operations.
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

  it('DB stays usable across suspend/resume', async () => {
    await app.addFiles(generateTestFiles(2, { startId: 1 }))
    await app.waitForNoActiveUploads()

    await app.suspend()
    expect(await app.app.files.queryCount({ order: 'ASC' })).toBe(2)

    await app.resumeFromSuspension()
    expect(await app.app.files.queryCount({ order: 'ASC' })).toBe(2)
  }, 60_000)

  it('sync-down writes reach the DB during drain', async () => {
    // Inject objects so sync-down has work to do.
    const now = Date.now()
    for (let i = 0; i < 10; i++) {
      app.sdk.injectObject({
        metadata: {
          id: `drain-file-${i}`,
          name: `drain-photo-${i}.jpg`,
          type: 'image/jpeg',
          kind: 'file',
          size: 1024,
          hash: `drain-hash-${i}`,
          createdAt: now - i * 1000,
          updatedAt: now - i * 1000,
          trashedAt: null,
        },
      })
    }

    // Trigger sync-down and let it start processing.
    app.triggerSyncDown()
    await waitForCondition(async () => (await app.getFiles()).length > 0, {
      timeout: 10_000,
      message: 'At least one file synced before suspend',
    })

    // Record how many files were synced before suspend.
    const countBeforeSuspend = (await app.getFiles()).length

    // Suspend while sync-down may still be processing. The drain phase
    // lets the in-flight batch finish its DB writes before the gate closes.
    await app.suspend()
    await app.resumeFromSuspension()

    // Pause the scheduler immediately so no new sync ticks run.
    app.pause()

    // The drain should have allowed sync-down to write at least as many
    // files as were present before suspend — no work should be lost.
    const countAfterResume = (await app.getFiles()).length
    expect(countAfterResume).toBeGreaterThanOrEqual(countBeforeSuspend)

    // Resume and let everything finish.
    app.resume()
    await app.waitForFileCount(10, 30_000)
    expect((await app.getFiles()).length).toBe(10)
  }, 60_000)

  it('upload DB writes succeed during drain', async () => {
    await app.addFiles(generateTestFiles(5, { startId: 1 }))

    // Wait for at least one file to be packing.
    await waitForCondition(
      () => {
        const uploads = app.app.uploads.getState().uploads
        return Object.values(uploads).some((u) => u.status === 'packing' || u.status === 'packed')
      },
      { timeout: 10_000, message: 'At least one file packing' },
    )

    // Record upload progress before suspend.
    const packedBefore = app.uploadManager.packedCount

    // Suspend — upload manager parks after finishing its current
    // packer.add() call. The DB write should succeed during drain.
    await app.suspend()
    await app.resumeFromSuspension()

    // No packed work should be lost — the upload manager's count
    // should not have regressed.
    expect(app.uploadManager.packedCount).toBeGreaterThanOrEqual(packedBefore)

    // All files should upload successfully after resume.
    await app.waitForNoActiveUploads()
    expect(app.sdk.getStoredObjects().length).toBe(5)
  }, 60_000)

  /**
   * These tests reflect the four BG-task lifecycle shapes from the
   * 0xdead10cc TestFlight crashes (v1.9.5):
   *
   * 1. Normal completion while backgrounded → DB closes.
   * 2. Timeout path (crash #1: timeout callback did not release) → DB closes.
   * 3. Overlapping tasks (logs showed two invocation IDs) → DB stays
   *    open until the last task releases.
   * 4. User foregrounds during task → release is a no-op (DB stays open).
   *
   * All four drive the same createSuspensionManager used by mobile.
   */
  describe('Background task lifecycle', () => {
    it('normal completion → auto-suspends when app is background', async () => {
      await app.setAppState('background')
      expect(app.isSuspended()).toBe(true)
      // onBeforeSuspend fires once on the first auto-suspend; no foreground.
      expect(app.hookCalls.onBeforeSuspend).toBe(1)
      expect(app.hookCalls.onForegroundActive).toBe(0)

      await app.simulateBackgroundTask('bg-fetch', async () => {
        expect(app.isSuspended()).toBe(false) // register reopened DB
        await app.addFiles(generateTestFiles(2, { startId: 1 }))
        await app.waitForNoActiveUploads()
      })

      // Release auto-suspended because appState=background and no more tasks.
      expect(app.isSuspended()).toBe(true)
      expect(app.getRunningBackgroundTaskIds()).toEqual([])
      // BG task wake fired onAfterResume once; release re-triggered
      // onBeforeSuspend. User never foregrounded.
      expect(app.hookCalls.onAfterResume).toBe(1)
      expect(app.hookCalls.onBeforeSuspend).toBe(2)
      expect(app.hookCalls.onForegroundActive).toBe(0)
    }, 60_000)

    it('timeout path still releases and re-suspends (crash-1 regression guard)', async () => {
      await app.setAppState('background')
      expect(app.isSuspended()).toBe(true)

      await app.registerBackgroundTask('bg-fetch')
      expect(app.isSuspended()).toBe(false)

      // Simulate iOS firing expirationHandler: the backgroundTasks.ts
      // timeout callback's IIFE calls releaseBackgroundTaskLifecycle —
      // which is what the harness's releaseBackgroundTask models.
      await app.releaseBackgroundTask('bg-fetch')

      expect(app.isSuspended()).toBe(true)
      expect(app.getRunningBackgroundTaskIds()).toEqual([])
      // Same hook shape as normal completion — BG-task wake didn't fire
      // onForegroundActive because AppState stayed 'background'.
      expect(app.hookCalls.onForegroundActive).toBe(0)
    }, 60_000)

    it('overlapping tasks — DB stays open until last release', async () => {
      await app.setAppState('background')
      expect(app.isSuspended()).toBe(true)

      await app.registerBackgroundTask('A')
      expect(app.isSuspended()).toBe(false)
      expect(app.getRunningBackgroundTaskIds()).toEqual(['A'])

      await app.registerBackgroundTask('B')
      expect(app.isSuspended()).toBe(false)
      expect(new Set(app.getRunningBackgroundTaskIds())).toEqual(new Set(['A', 'B']))

      await app.releaseBackgroundTask('A')
      expect(app.isSuspended()).toBe(false) // B still running
      expect(app.getRunningBackgroundTaskIds()).toEqual(['B'])

      await app.releaseBackgroundTask('B')
      expect(app.isSuspended()).toBe(true) // only now
      expect(app.getRunningBackgroundTaskIds()).toEqual([])
      // Two registers, but only the first triggers a real resume; second
      // is a no-op (already active). Foreground hook must not fire.
      expect(app.hookCalls.onAfterResume).toBe(1)
      expect(app.hookCalls.onForegroundActive).toBe(0)
    }, 60_000)

    it('user foregrounds during BG task — release does not suspend', async () => {
      await app.setAppState('background')
      expect(app.isSuspended()).toBe(true)

      await app.registerBackgroundTask('bg-fetch')
      expect(app.isSuspended()).toBe(false)
      // BG-task wake didn't fire onForegroundActive — appState still bg.
      expect(app.hookCalls.onForegroundActive).toBe(0)

      // User opens the app while the BG task is still registered. The
      // manager is already resumed, so onAfterResume does NOT fire a
      // second time. onForegroundActive must fire here — that's the whole
      // reason this hook exists.
      await app.setAppState('foreground')
      expect(app.isSuspended()).toBe(false)
      expect(app.hookCalls.onForegroundActive).toBe(1)
      expect(app.hookCalls.onAfterResume).toBe(1) // unchanged from BG-task wake

      await app.releaseBackgroundTask('bg-fetch')
      expect(app.isSuspended()).toBe(false) // user still has app open
      expect(app.areServicesRunning()).toBe(true)

      // App should still function normally.
      await app.addFiles(generateTestFiles(2, { startId: 1 }))
      await app.waitForNoActiveUploads()
      expect(app.sdk.getStoredObjects().length).toBe(2)
    }, 60_000)
  })
})
