/**
 * Upload Flow Integration Test
 *
 * Tests that the scanner detects files → queues → uploads automatically.
 * NO manual flush() calls - relies on automatic triggers.
 *
 * Timing notes (with test config):
 * - Scanner runs every 1 second
 * - Idle timeout for batch flush is 1 second
 * - So from file add to upload start: ~2-3 seconds
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

describe('Upload Flow Integration', () => {
  let harness: AppCoreHarness

  beforeEach(async () => {
    harness = createHarness()
    await harness.start()
  })

  afterEach(async () => {
    await harness.shutdown()
  })

  it('scanner detects files and uploads automatically', async () => {
    // Add files to DB (simulating import from camera roll)
    const fileFactories = generateTestFiles(3)
    const files = await addTestFilesToHarness(harness, fileFactories)

    // Assert: Files start with no upload state
    expect(getUploadState(files[0].id)).toBeUndefined()

    // Wait for scanner to detect files (~1s) and batch to flush (~1s more)
    await waitForCondition(
      () => {
        const state = getUploadState(files[0].id)
        return state !== undefined
      },
      { timeout: 10_000, message: 'Files to be detected by scanner' },
    )

    // Wait for uploads to complete (removed from store on success)
    await harness.waitForNoActiveUploads(15_000)

    // Assert: SDK received all files
    expect(harness.sdk.getStoredObjects()).toHaveLength(3)

    // Assert: Upload counts are zero
    expect(getUploadCounts().total).toBe(0)
  }, 30_000)

  it('handles multiple small files in single batch', async () => {
    const fileFactories = generateTestFiles(5, { startId: 100 })
    const files = await addTestFilesToHarness(harness, fileFactories)

    // Wait for scanner to detect files first
    await waitForCondition(
      () => {
        const state = getUploadState(files[0].id)
        return state !== undefined
      },
      { timeout: 10_000, message: 'Files to be detected by scanner' },
    )

    // Then wait for uploads to complete
    await harness.waitForNoActiveUploads(15_000)

    // All files should be in SDK
    expect(harness.sdk.getStoredObjects()).toHaveLength(5)
  }, 30_000)
})
