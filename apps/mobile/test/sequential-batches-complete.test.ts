/**
 * Verify multiple batches are processed sequentially without getting stuck.
 *
 * After each batch completes, flushPendingBatch() checks if new files were
 * queued during processing and flushes them. This ensures sequential batches
 * all complete even when files are added between batches.
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

describe('Sequential Batches', () => {
  let harness: AppCoreHarness

  beforeEach(async () => {
    harness = createHarness()
    await harness.start()
  })

  afterEach(async () => {
    await harness.shutdown()
  })

  it('sequential batches all complete successfully', async () => {
    // First batch
    const batch1 = generateTestFiles(2, { startId: 1 })
    await addTestFilesToHarness(harness, batch1)

    // Wait for scanner to detect files
    await waitForCondition(() => getUploadCounts().total >= 1, {
      timeout: 10_000,
      message: 'First batch to be detected',
    })
    await harness.waitForNoActiveUploads(15_000)

    expect(harness.sdk.getStoredObjects()).toHaveLength(2)

    // Second batch
    const batch2 = generateTestFiles(2, { startId: 10 })
    await addTestFilesToHarness(harness, batch2)

    // Wait for scanner to detect files
    await waitForCondition(() => getUploadCounts().total >= 1, {
      timeout: 10_000,
      message: 'Second batch to be detected',
    })
    await harness.waitForNoActiveUploads(15_000)

    expect(harness.sdk.getStoredObjects()).toHaveLength(4)

    // Third batch
    const batch3 = generateTestFiles(2, { startId: 20 })
    await addTestFilesToHarness(harness, batch3)

    // Wait for scanner to detect files
    await waitForCondition(() => getUploadCounts().total >= 1, {
      timeout: 10_000,
      message: 'Third batch to be detected',
    })
    await harness.waitForNoActiveUploads(15_000)

    // All 6 files should be uploaded
    expect(harness.sdk.getStoredObjects()).toHaveLength(6)
  }, 60_000)
})
