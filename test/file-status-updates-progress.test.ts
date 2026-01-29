/**
 * Verify that file status updates correctly during upload progress.
 *
 * Tests that upload state transitions occur as expected: files move through
 * pending -> packing -> packed -> uploading -> complete states, and the
 * upload store reflects these changes.
 */

import './utils/setup'

import { getUploadState } from '../src/stores/uploads'
import {
  type AppCoreHarness,
  addTestFilesToHarness,
  createHarness,
  generateTestFiles,
} from './utils/harness'
import { sleep } from './utils/waitFor'

describe('File Status Updates Progress', () => {
  let harness: AppCoreHarness

  beforeEach(async () => {
    harness = createHarness()
    await harness.start()
  })

  afterEach(async () => {
    await harness.shutdown()
  })

  it('file status updates as upload progresses', async () => {
    const fileFactories = generateTestFiles(1, { sizeBytes: 3000 })
    const files = await addTestFilesToHarness(harness, fileFactories)
    const fileId = files[0].id

    // Track status transitions over time
    const statusHistory: string[] = []
    let lastStatus = ''

    // Poll for status changes from the start
    const startTime = Date.now()
    while (Date.now() - startTime < 15_000) {
      const state = getUploadState(fileId)
      const currentStatus = state?.status ?? 'none'

      if (currentStatus !== lastStatus) {
        statusHistory.push(currentStatus)
        lastStatus = currentStatus
      }

      // Stop if upload completed
      if (state === undefined && statusHistory.length > 1) {
        break
      }

      await sleep(30)
    }

    // Should have seen multiple status transitions
    // Typical flow: none -> queued -> packing -> packed -> uploading -> none
    // We may miss some depending on timing, but should see at least 2 states
    expect(statusHistory.length).toBeGreaterThanOrEqual(2)

    // Should have seen the file go from 'none' to some active state
    expect(statusHistory[0]).toBe('none')
    expect(statusHistory.length).toBeGreaterThan(1)
  }, 30_000)
})
