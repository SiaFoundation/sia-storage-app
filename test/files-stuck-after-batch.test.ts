/**
 * Verify files queued during an upload are eventually uploaded.
 *
 * When files are added while a batch is uploading, the idle timer may fire
 * but flush() is skipped because isProcessing=true. After the current batch
 * completes, flushPendingBatch() ensures pending files are flushed.
 */

import './utils/setup'

import { getUploadCounts } from '../src/stores/uploads'
import {
  type AppCoreHarness,
  addTestFilesToHarness,
  createHarness,
  generateTestFiles,
} from './utils/harness'
import { waitForCondition } from './utils/waitFor'

describe('Files Queued During Upload', () => {
  let harness: AppCoreHarness

  beforeEach(async () => {
    harness = createHarness()
    await harness.start()
  })

  afterEach(async () => {
    await harness.shutdown()
  })

  it('files queued during upload are eventually uploaded', async () => {
    // Start first batch
    const batch1 = generateTestFiles(2, { startId: 1 })
    await addTestFilesToHarness(harness, batch1)

    // Wait for first batch to start uploading (at least one file detected)
    await waitForCondition(
      () => {
        const counts = getUploadCounts()
        return counts.total >= 1
      },
      { timeout: 10_000, message: 'First batch to start' },
    )

    // Add more files WHILE first batch is uploading
    const batch2 = generateTestFiles(2, { startId: 100 })
    await addTestFilesToHarness(harness, batch2)

    // Wait for ALL files to complete
    await harness.waitForNoActiveUploads(30_000)

    // All 4 files should be uploaded
    expect(harness.sdk.getStoredObjects()).toHaveLength(4)
  }, 60_000)
})
