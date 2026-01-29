/**
 * Connectivity Integration Test
 *
 * Tests offline/online transitions and upload behavior.
 *
 * These tests let the app's service intervals naturally run rather than
 * manually calling sync functions, verifying the full system works together.
 *
 * Timing: Scanner runs every 1s, sync runs every 2s
 */

import './utils/setup'

import { readAllFileRecords } from '../src/stores/files'
import { setIsConnected } from '../src/stores/sdk'
import { getUploadCounts } from '../src/stores/uploads'
import {
  type AppCoreHarness,
  addTestFilesToHarness,
  createHarness,
  generateTestFiles,
} from './utils/harness'
import { generateMockFileMetadata } from './utils/mockSdk'
import { sleep } from './utils/testHelpers'
import { waitForCondition } from './utils/waitFor'

describe('Connectivity Integration', () => {
  let harness: AppCoreHarness

  beforeEach(async () => {
    harness = createHarness()
    await harness.start()
  })

  afterEach(async () => {
    await harness.shutdown()
  })

  it('queues uploads while offline, completes when online', async () => {
    // Go offline first
    harness.sdk.setConnected(false)
    setIsConnected(false)

    // Add files while offline
    const fileFactories = generateTestFiles(2, { startId: 1 })
    await addTestFilesToHarness(harness, fileFactories)

    // Wait for scanner to run (should skip upload due to offline)
    // Scanner runs every 1s, so 3s is enough time for multiple runs
    await sleep(3000)

    // Files should NOT be uploaded while offline
    expect(harness.sdk.getStoredObjects()).toHaveLength(0)

    // Come back online
    harness.sdk.setConnected(true)
    setIsConnected(true)

    // Wait for scanner to detect files and start processing them
    await waitForCondition(() => getUploadCounts().total >= 1, {
      timeout: 10_000,
      message: 'Files to be detected after coming online',
    })

    // Then wait for all uploads to complete
    await harness.waitForNoActiveUploads(30_000)

    // Files should now be uploaded
    expect(harness.sdk.getStoredObjects()).toHaveLength(2)
  }, 60_000)

  it('sync fails gracefully when offline', async () => {
    // Inject an object while online
    harness.sdk.injectObject({
      metadata: generateMockFileMetadata(1, { name: 'sync-test.jpg' }),
    })

    // Go offline before sync can happen
    harness.sdk.setConnected(false)
    setIsConnected(false)

    // Wait for sync interval to pass while offline - sync should skip
    await sleep(3000)

    // No files should be synced while offline
    const filesOffline = await readAllFileRecords({ order: 'ASC' })
    expect(filesOffline.length).toBe(0)

    // Come back online
    harness.sdk.setConnected(true)
    setIsConnected(true)

    // Wait for syncDownEvents service to naturally sync the file (runs every 2s)
    await waitForCondition(
      async () => {
        const files = await readAllFileRecords({ order: 'ASC' })
        return files.length === 1
      },
      { timeout: 10_000, message: 'File to sync after coming online' },
    )
  })

  it('handles intermittent connectivity', async () => {
    // Start online and add files
    const fileFactories = generateTestFiles(1, { startId: 10 })
    await addTestFilesToHarness(harness, fileFactories)

    // Wait for file to be detected
    await waitForCondition(() => getUploadCounts().total >= 1, {
      timeout: 15_000,
      message: 'File to be detected',
    })

    // Briefly go offline
    harness.sdk.setConnected(false)
    setIsConnected(false)

    await sleep(1000)

    // Come back online
    harness.sdk.setConnected(true)
    setIsConnected(true)

    // Wait for upload to complete
    await harness.waitForNoActiveUploads(30_000)

    expect(harness.sdk.getStoredObjects()).toHaveLength(1)
  }, 60_000)
})
