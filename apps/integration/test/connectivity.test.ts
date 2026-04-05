import { createEmptyIndexerStorage, generateMockFileMetadata } from '@siastorage/sdk-mock'
import { createTestApp, generateTestFiles, sleep, type TestApp, waitForCondition } from './app'

describe('Connectivity Integration', () => {
  let app: TestApp

  beforeEach(async () => {
    app = createTestApp(createEmptyIndexerStorage())
    await app.start()
  })

  afterEach(async () => {
    await app.shutdown()
  })

  it('queues uploads while offline, completes when online', async () => {
    app.setConnected(false)

    const fileFactories = generateTestFiles(2, { startId: 1 })
    await app.addFiles(fileFactories)

    // Scanner runs every 1s, so 3s is enough time for multiple runs
    await sleep(3000)

    expect(app.sdk.getStoredObjects()).toHaveLength(0)

    app.setConnected(true)

    await waitForCondition(() => app.getUploadCounts().total >= 1, {
      timeout: 10_000,
      message: 'Files to be detected after coming online',
    })

    await app.waitForNoActiveUploads(30_000)

    expect(app.sdk.getStoredObjects()).toHaveLength(2)
  }, 60_000)

  it('sync fails gracefully when offline', async () => {
    app.sdk.injectObject({
      metadata: generateMockFileMetadata(1, { name: 'sync-test.jpg' }),
    })

    app.setConnected(false)

    await sleep(3000)

    const filesOffline = await app.getFiles()
    expect(filesOffline.length).toBe(0)

    app.setConnected(true)

    await waitForCondition(
      async () => {
        const files = await app.getFiles()
        return files.length === 1
      },
      { timeout: 10_000, message: 'File to sync after coming online' },
    )
  })

  it('handles intermittent connectivity', async () => {
    const fileFactories = generateTestFiles(1, { startId: 10 })
    await app.addFiles(fileFactories)

    await waitForCondition(() => app.getUploadCounts().total >= 1, {
      timeout: 15_000,
      message: 'File to be detected',
    })

    app.setConnected(false)

    await sleep(1000)

    app.setConnected(true)

    await app.waitForNoActiveUploads(30_000)

    expect(app.sdk.getStoredObjects().length).toBeGreaterThanOrEqual(1)
  }, 60_000)
})
