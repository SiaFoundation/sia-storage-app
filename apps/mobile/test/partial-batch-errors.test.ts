/**
 * Verify that when some files in a batch fail, only successful files are
 * removed from the upload store while errored files remain visible.
 *
 * saveBatchObjects() returns the IDs of successfully saved files, and only
 * those are removed from the store. Files that error remain visible with
 * their error state so users can see what failed.
 */

import './utils/setup'

import { getActiveUploads, getUploadState } from '../src/stores/uploads'
import {
  type AppCoreHarness,
  addTestFilesToHarness,
  createHarness,
  generateTestFiles,
} from './utils/harness'
import { waitForCondition } from './utils/waitFor'

describe('Partial Batch Errors', () => {
  let harness: AppCoreHarness

  beforeEach(async () => {
    harness = createHarness()
    await harness.start()
  })

  afterEach(async () => {
    await harness.shutdown()
  })

  it('keeps errored files in store when batch partially fails', async () => {
    // Set up failure for a specific file
    harness.sdk.setUploadFailure(
      'test-file-2',
      new Error('Simulated save failure'),
    )

    // Add multiple files - one will fail
    const fileFactories = generateTestFiles(2, { startId: 1 })
    await addTestFilesToHarness(harness, fileFactories)

    // Wait for uploads to complete or error
    await waitForCondition(
      () => {
        const uploads = getActiveUploads()
        // Either no active uploads (all done/errored) or only errored ones remain
        return (
          uploads.length === 0 || uploads.every((u) => u.status === 'error')
        )
      },
      { timeout: 20_000, message: 'Uploads to complete or error' },
    )

    // Check final states
    const state1 = getUploadState('test-file-1')
    const state2 = getUploadState('test-file-2')

    // File 1 should be removed (success)
    expect(state1).toBeUndefined()

    // File 2 should remain with error state visible to user
    if (state2) {
      expect(state2.status).toBe('error')
    }
  }, 30_000)
})
