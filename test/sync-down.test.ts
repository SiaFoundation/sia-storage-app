/**
 * Tests that server events sync down correctly.
 */

import './utils/setup'

import { readAllFileRecords } from '../src/stores/files'
import { type AppCoreHarness, createHarness } from './utils/harness'
import { generateMockFileMetadata } from './utils/mockSdk'
import { waitForCondition } from './utils/waitFor'

describe('Sync Down Integration', () => {
  let harness: AppCoreHarness

  beforeEach(async () => {
    harness = createHarness()
    await harness.start()
  })

  afterEach(async () => {
    await harness.shutdown()
  })

  it('syncs objects injected from server', async () => {
    // Inject object from "another device"
    const metadata = generateMockFileMetadata(1, { name: 'from-server.jpg' })
    harness.sdk.injectObject({ metadata })

    // Wait for syncDownEvents service to pick up the object (runs every 2s)
    await waitForCondition(
      async () => {
        const files = await readAllFileRecords({ order: 'ASC' })
        return files.length === 1 && files[0].name === 'from-server.jpg'
      },
      { timeout: 10_000, message: 'File to sync from server' },
    )
  })

  it('syncs multiple objects from server', async () => {
    // Inject multiple objects
    harness.sdk.injectObject({
      metadata: generateMockFileMetadata(1, { name: 'file1.jpg' }),
    })
    harness.sdk.injectObject({
      metadata: generateMockFileMetadata(2, { name: 'file2.jpg' }),
    })
    harness.sdk.injectObject({
      metadata: generateMockFileMetadata(3, { name: 'file3.jpg' }),
    })

    // Wait for syncDownEvents service to sync all files
    await waitForCondition(
      async () => {
        const files = await readAllFileRecords({ order: 'ASC' })
        return files.length === 3
      },
      { timeout: 10_000, message: 'All 3 files to sync' },
    )

    const files = await readAllFileRecords({ order: 'ASC' })
    const names = files.map((f) => f.name).sort()
    expect(names).toContain('file1.jpg')
    expect(names).toContain('file2.jpg')
    expect(names).toContain('file3.jpg')
  })

  it('handles metadata updates from server', async () => {
    // Create initial object
    const metadata = generateMockFileMetadata(1, { name: 'original.jpg' })
    const stored = harness.sdk.injectObject({ metadata })

    // Wait for initial sync
    await waitForCondition(
      async () => {
        const files = await readAllFileRecords({ order: 'ASC' })
        return files.length === 1 && files[0].name === 'original.jpg'
      },
      { timeout: 10_000, message: 'Initial file to sync' },
    )

    // Inject metadata change
    harness.sdk.injectMetadataChange(stored.id, { name: 'renamed.jpg' })

    // Wait for update to sync
    await waitForCondition(
      async () => {
        const files = await readAllFileRecords({ order: 'ASC' })
        return files.length === 1 && files[0].name === 'renamed.jpg'
      },
      { timeout: 10_000, message: 'Renamed file to sync' },
    )
  })

  it('handles delete events from server', async () => {
    // Create and sync an object
    const metadata = generateMockFileMetadata(1, { name: 'to-delete.jpg' })
    const stored = harness.sdk.injectObject({ metadata })

    // Wait for initial sync
    await waitForCondition(
      async () => {
        const files = await readAllFileRecords({ order: 'ASC' })
        return files.length === 1
      },
      { timeout: 10_000, message: 'File to sync initially' },
    )

    // Inject delete event
    harness.sdk.injectDeleteEvent(stored.id)

    // Wait for delete to sync
    await waitForCondition(
      async () => {
        const files = await readAllFileRecords({ order: 'ASC' })
        return files.length === 0
      },
      { timeout: 10_000, message: 'File to be deleted' },
    )
  })
})
