import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import {
  createTestApp,
  generateTestFiles,
  type TestApp,
  waitForCondition,
} from './app'

describe('Files Queued During Upload', () => {
  let app: TestApp

  beforeEach(async () => {
    app = createTestApp(createEmptyIndexerStorage())
    await app.start()
  })

  afterEach(async () => {
    await app.shutdown()
  })

  it('files queued during upload are eventually uploaded', async () => {
    const batch1 = generateTestFiles(2, { startId: 1 })
    await app.addFiles(batch1)

    await waitForCondition(() => app.getUploadCounts().total >= 1, {
      timeout: 10_000,
      message: 'First batch to start',
    })

    const batch2 = generateTestFiles(2, { startId: 100 })
    await app.addFiles(batch2)

    await app.waitForNoActiveUploads(30_000)

    expect(app.sdk.getStoredObjects()).toHaveLength(4)
  }, 60_000)
})
