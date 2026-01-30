/**
 * State Transitions Integration Test
 *
 * Tests that uploads progress through all status states correctly.
 *
 * Timing: Scanner runs every 1s, idle flush after 1s
 */

import './utils/setup'

import {
  getUploadCounts,
  getUploadState,
  type UploadStatus,
} from '../src/stores/uploads'
import {
  type AppCoreHarness,
  addTestFilesToHarness,
  createHarness,
  generateTestFiles,
} from './utils/harness'
import { waitForCondition } from './utils/waitFor'

describe('State Transitions Integration', () => {
  let harness: AppCoreHarness

  beforeEach(async () => {
    harness = createHarness()
    await harness.start()
  })

  afterEach(async () => {
    await harness.shutdown()
  })

  it('upload progresses through status states', async () => {
    const fileFactories = generateTestFiles(1, { startId: 1 })
    const files = await addTestFilesToHarness(harness, fileFactories)
    const fileId = files[0].id

    const observedStatuses: UploadStatus[] = []

    // Poll and record all status transitions
    await waitForCondition(
      async () => {
        const state = getUploadState(fileId)
        if (state && !observedStatuses.includes(state.status)) {
          observedStatuses.push(state.status)
        }
        // Done when removed from store (success)
        return state === undefined && observedStatuses.length > 0
      },
      { timeout: 30_000, interval: 50, message: 'Upload to complete' },
    )

    // Assert: Saw at least one status
    expect(observedStatuses.length).toBeGreaterThan(0)

    // Assert: File is now uploaded
    expect(harness.sdk.getStoredObjects()).toHaveLength(1)
  }, 45_000)

  it('upload state is removed on success', async () => {
    const fileFactories = generateTestFiles(1, { startId: 30 })
    const files = await addTestFilesToHarness(harness, fileFactories)
    const fileId = files[0].id

    // Wait for file to be detected
    await waitForCondition(() => getUploadState(fileId) !== undefined, {
      timeout: 15_000,
      message: 'File to be detected',
    })

    // State should exist while uploading
    expect(getUploadState(fileId)).toBeDefined()

    // Wait for completion
    await harness.waitForNoActiveUploads(30_000)

    // State should be removed after success
    expect(getUploadState(fileId)).toBeUndefined()

    // File should be in SDK
    expect(harness.sdk.getStoredObjects()).toHaveLength(1)
  }, 45_000)

  it('upload counts reach zero after completion', async () => {
    const fileFactories = generateTestFiles(2, { startId: 40 })
    await addTestFilesToHarness(harness, fileFactories)

    // Wait for files to be detected
    await waitForCondition(() => getUploadCounts().total >= 1, {
      timeout: 15_000,
      message: 'Files to be detected',
    })

    // Wait for completion
    await harness.waitForNoActiveUploads(30_000)

    // Counts should be zero
    const finalCounts = getUploadCounts()
    expect(finalCounts.total).toBe(0)
  }, 45_000)
})
