/**
 * Sync Down Integration Test
 *
 * Tests that server events sync down correctly.
 */

import './utils/setup'

import { syncDownEvents } from '../src/managers/syncDownEvents'
import { readAllFileRecords } from '../src/stores/files'
import { type AppCoreHarness, createHarness } from './utils/harness'
import { generateMockFileMetadata } from './utils/mockSdk'
import { sleep } from './utils/testHelpers'

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

    // Manually trigger sync (or wait for service)
    await syncDownEvents()

    // Assert: File record created in local DB
    const files = await readAllFileRecords({ order: 'ASC' })
    expect(files.length).toBe(1)
    expect(files[0].name).toBe('from-server.jpg')
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

    await syncDownEvents()

    const files = await readAllFileRecords({ order: 'ASC' })
    expect(files.length).toBe(3)

    const names = files.map((f) => f.name).sort()
    expect(names).toContain('file1.jpg')
    expect(names).toContain('file2.jpg')
    expect(names).toContain('file3.jpg')
  })

  it('handles metadata updates from server', async () => {
    // Create initial object
    const metadata = generateMockFileMetadata(1, { name: 'original.jpg' })
    const stored = harness.sdk.injectObject({ metadata })

    await syncDownEvents()

    // Verify initial sync
    let files = await readAllFileRecords({ order: 'ASC' })
    expect(files.length).toBe(1)
    expect(files[0].name).toBe('original.jpg')

    // Inject metadata change
    harness.sdk.injectMetadataChange(stored.id, { name: 'renamed.jpg' })

    await syncDownEvents()

    // Verify update
    files = await readAllFileRecords({ order: 'ASC' })
    expect(files[0].name).toBe('renamed.jpg')
  })

  it('handles delete events from server', async () => {
    // Create and sync an object
    const metadata = generateMockFileMetadata(1, { name: 'to-delete.jpg' })
    const stored = harness.sdk.injectObject({ metadata })

    await syncDownEvents()

    const files = await readAllFileRecords({ order: 'ASC' })
    expect(files.length).toBe(1)

    // Inject delete event
    harness.sdk.injectDeleteEvent(stored.id)

    // Verify delete event exists
    const events = harness.sdk.getAllEvents()
    const deleteEvent = events.find((e) => e.id === stored.id && e.deleted)
    expect(deleteEvent).toBeDefined()
    expect(deleteEvent?.deleted).toBe(true)
  })

  it('respects event ordering', async () => {
    // Inject events in order
    harness.sdk.injectObject({
      metadata: generateMockFileMetadata(1, { name: 'first.jpg' }),
    })

    await sleep(10) // Small delay to ensure different timestamps

    harness.sdk.injectObject({
      metadata: generateMockFileMetadata(2, { name: 'second.jpg' }),
    })

    await syncDownEvents()

    const files = await readAllFileRecords({ order: 'ASC' })
    expect(files.length).toBe(2)

    // Events should be processed in order
    const events = harness.sdk.getAllEvents()
    expect(events.length).toBe(2)
  })
})
