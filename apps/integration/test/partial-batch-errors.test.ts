import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import {
  createTestApp,
  generateTestFiles,
  type TestApp,
  waitForCondition,
} from './app'

describe('Partial Batch Errors', () => {
  let app: TestApp

  beforeEach(async () => {
    app = createTestApp(createEmptyIndexerStorage())
    await app.start()
  })

  afterEach(async () => {
    await app.shutdown()
  })

  it('keeps errored files in store when batch partially fails', async () => {
    app.sdk.setUploadFailure('test-file-2', new Error('Simulated save failure'))

    const fileFactories = generateTestFiles(2, { startId: 1 })
    await app.addFiles(fileFactories)

    await waitForCondition(
      () => {
        const active = app.getActiveUploads()
        return active.length === 0 || active.every((u) => u.status === 'error')
      },
      { timeout: 20_000, message: 'Uploads to complete or error' },
    )

    const state1 = app.getUploadState('test-file-1')
    const state2 = app.getUploadState('test-file-2')

    expect(state1).toBeUndefined()

    if (state2) {
      expect(state2.status).toBe('error')
    }
  }, 30_000)
})
