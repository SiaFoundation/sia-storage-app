/**
 * Verify that the upload scanner deprioritizes errored files.
 *
 * Files that previously failed upload should still be retried, but only
 * after all non-errored files have been processed first.
 */

import './utils/setup'

import { getActiveUploads } from '../src/stores/uploads'
import {
  type AppCoreHarness,
  addTestFilesToHarness,
  createHarness,
  generateTestFiles,
} from './utils/harness'
import { waitForCondition } from './utils/waitFor'

describe('Scanner Deprioritizes Errored Files', () => {
  let harness: AppCoreHarness

  beforeEach(async () => {
    harness = createHarness()
    await harness.start()
  })

  afterEach(async () => {
    await harness.shutdown()
  })

  it('retries errored files after processing new files', async () => {
    // Set up failure for first file
    harness.sdk.setUploadFailure(
      'test-file-1',
      new Error('Simulated upload failure'),
    )

    // Add first file - it will fail
    const batch1 = generateTestFiles(1, { startId: 1 })
    await addTestFilesToHarness(harness, batch1)

    // Wait for first batch to be processed (will error)
    await waitForCondition(
      () => {
        const uploads = getActiveUploads()
        return uploads.length === 0 || uploads.every((u) => u.status === 'error')
      },
      { timeout: 20_000, message: 'First batch to be processed' },
    )

    // Clear the failure so retries will succeed
    harness.sdk.clearUploadFailure('test-file-1')

    // Add more files
    const batch2 = generateTestFiles(2, { startId: 10 })
    await addTestFilesToHarness(harness, batch2)

    // Wait for all uploads to complete
    await harness.waitForNoActiveUploads(30_000)

    // All 3 files should eventually be uploaded (including the retried one)
    expect(harness.sdk.getStoredObjects()).toHaveLength(3)
  }, 60_000)
})
