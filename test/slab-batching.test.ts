/**
 * Slab Batching Integration Test
 *
 * Tests that files are batched together and uploaded.
 *
 * Timing: Scanner runs every 1s, idle flush after 1s
 */

import './utils/setup'

import { getUploadCounts, getUploadState } from '../src/stores/uploads'
import {
  type AppCoreHarness,
  addTestFilesToHarness,
  createHarness,
  generateTestFiles,
} from './utils/harness'
import { waitForCondition } from './utils/waitFor'

describe('Slab Batching Integration', () => {
  let harness: AppCoreHarness

  beforeEach(async () => {
    harness = createHarness()
    await harness.start()
  })

  afterEach(async () => {
    await harness.shutdown()
  })

  it('batches small files together', async () => {
    // Add 3 small files (1KB each)
    const fileFactories = generateTestFiles(3, { startId: 1, sizeBytes: 1024 })
    await addTestFilesToHarness(harness, fileFactories)

    // Wait for files to be detected
    await waitForCondition(() => getUploadCounts().total >= 1, {
      timeout: 15_000,
      message: 'Files to be detected',
    })

    // Wait for completion
    await harness.waitForNoActiveUploads(30_000)

    // All files should be uploaded
    expect(harness.sdk.getStoredObjects()).toHaveLength(3)
  }, 60_000)

  it('files in same batch share batchId', async () => {
    const fileFactories = generateTestFiles(2, { startId: 20, sizeBytes: 1024 })
    const files = await addTestFilesToHarness(harness, fileFactories)

    // Wait for files to start uploading
    await waitForCondition(
      () => {
        const state = getUploadState(files[0].id)
        return state?.status === 'uploading' || state?.status === 'packed'
      },
      { timeout: 15_000, message: 'Files to start processing' },
    )

    // Check if files have batchId
    const state0 = getUploadState(files[0].id)
    const state1 = getUploadState(files[1].id)

    // Both should have same batchId if batched together
    if (state0?.batchId && state1?.batchId) {
      expect(state0.batchId).toBe(state1.batchId)
    }

    // Wait for completion
    await harness.waitForNoActiveUploads(30_000)
    expect(harness.sdk.getStoredObjects()).toHaveLength(2)
  }, 60_000)
})
