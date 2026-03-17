import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import {
  createTestApp,
  generateTestFiles,
  type TestApp,
  waitForCondition,
} from './app'

describe('Sequential Batches', () => {
  let app: TestApp

  beforeEach(async () => {
    app = createTestApp(createEmptyIndexerStorage())
    await app.start()
  })

  afterEach(async () => {
    await app.shutdown()
  })

  it('sequential batches all complete successfully', async () => {
    const batch1 = generateTestFiles(2, { startId: 1 })
    await app.addFiles(batch1)

    await waitForCondition(() => app.getUploadCounts().total >= 1, {
      timeout: 10_000,
      message: 'First batch to be detected',
    })
    await app.waitForNoActiveUploads(15_000)

    expect(app.sdk.getStoredObjects()).toHaveLength(2)

    const batch2 = generateTestFiles(2, { startId: 10 })
    await app.addFiles(batch2)

    await waitForCondition(() => app.getUploadCounts().total >= 1, {
      timeout: 10_000,
      message: 'Second batch to be detected',
    })
    await app.waitForNoActiveUploads(15_000)

    expect(app.sdk.getStoredObjects()).toHaveLength(4)

    const batch3 = generateTestFiles(2, { startId: 20 })
    await app.addFiles(batch3)

    await waitForCondition(() => app.getUploadCounts().total >= 1, {
      timeout: 10_000,
      message: 'Third batch to be detected',
    })
    await app.waitForNoActiveUploads(15_000)

    expect(app.sdk.getStoredObjects()).toHaveLength(6)
  }, 60_000)
})
