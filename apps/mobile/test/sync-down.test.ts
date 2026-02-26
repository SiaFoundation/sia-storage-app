/**
 * Tests that server events sync down correctly.
 */

import './utils/setup'

import {
  readAllDirectoriesWithCounts,
  readDirectoryNameForFile,
} from '../src/stores/directories'
import { readAllFileRecords } from '../src/stores/files'
import { addTagToFile, readTagsForFile } from '../src/stores/tags'
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

    // Wait for syncDown to tombstone the file
    await waitForCondition(
      async () => {
        const files = await readAllFileRecords({ order: 'ASC' })
        return files.length === 1 && files[0].deletedAt != null
      },
      { timeout: 10_000, message: 'File to be tombstoned' },
    )
  })

  it('syncs objects with tags from server', async () => {
    harness.sdk.injectObject({
      metadata: generateMockFileMetadata(1, {
        name: 'tagged.jpg',
        tags: ['vacation', 'beach'],
      }),
    })

    let fileId: string | undefined
    await waitForCondition(
      async () => {
        const files = await readAllFileRecords({ order: 'ASC' })
        if (files.length === 1 && files[0].name === 'tagged.jpg') {
          fileId = files[0].id
          return true
        }
        return false
      },
      { timeout: 10_000, message: 'Tagged file to sync' },
    )

    const tags = (await readTagsForFile(fileId!)).filter((t) => !t.system)
    expect(tags.map((t) => t.name).sort()).toEqual(['beach', 'vacation'])
  })

  it('preserves local tags when remote metadata has no tag data', async () => {
    const metadata = generateMockFileMetadata(1, { name: 'photo.jpg' })
    harness.sdk.injectObject({ metadata })

    let fileId: string | undefined
    await waitForCondition(
      async () => {
        const files = await readAllFileRecords({ order: 'ASC' })
        if (files.length === 1) {
          fileId = files[0].id
          return true
        }
        return false
      },
      { timeout: 10_000, message: 'File to sync' },
    )

    await addTagToFile(fileId!, 'myTag')
    const tagsAfterAdd = (await readTagsForFile(fileId!)).filter(
      (t) => !t.system,
    )
    expect(tagsAfterAdd).toHaveLength(1)
    expect(tagsAfterAdd[0].name).toBe('myTag')

    await new Promise((r) => setTimeout(r, 5000))

    const tagsAfterSync = (await readTagsForFile(fileId!)).filter(
      (t) => !t.system,
    )
    expect(tagsAfterSync).toHaveLength(1)
    expect(tagsAfterSync[0].name).toBe('myTag')
  })

  it('syncs tag updates from server', async () => {
    const stored = harness.sdk.injectObject({
      metadata: generateMockFileMetadata(1, {
        name: 'file.jpg',
        tags: ['original'],
      }),
    })

    let fileId: string | undefined
    await waitForCondition(
      async () => {
        const files = await readAllFileRecords({ order: 'ASC' })
        if (files.length === 1) {
          fileId = files[0].id
          const tags = (await readTagsForFile(files[0].id)).filter(
            (t) => !t.system,
          )
          return tags.length === 1 && tags[0].name === 'original'
        }
        return false
      },
      { timeout: 10_000, message: 'Initial tags to sync' },
    )

    harness.sdk.injectMetadataChange(stored.id, { tags: ['updated', 'new'] })

    await waitForCondition(
      async () => {
        const tags = (await readTagsForFile(fileId!)).filter((t) => !t.system)
        return (
          tags.length === 2 &&
          tags
            .map((t) => t.name)
            .sort()
            .join(',') === 'new,updated'
        )
      },
      { timeout: 10_000, message: 'Updated tags to sync' },
    )
  })

  it('syncs objects with directory from server', async () => {
    harness.sdk.injectObject({
      metadata: generateMockFileMetadata(1, {
        name: 'vacation-photo.jpg',
        directory: 'Vacation',
      }),
    })

    let fileId: string | undefined
    await waitForCondition(
      async () => {
        const files = await readAllFileRecords({ order: 'ASC' })
        if (files.length === 1 && files[0].name === 'vacation-photo.jpg') {
          fileId = files[0].id
          return true
        }
        return false
      },
      { timeout: 10_000, message: 'File with directory to sync' },
    )

    const dirName = await readDirectoryNameForFile(fileId!)
    expect(dirName).toBe('Vacation')

    const dirs = await readAllDirectoriesWithCounts()
    expect(dirs).toHaveLength(1)
    expect(dirs[0].name).toBe('Vacation')
    expect(dirs[0].fileCount).toBe(1)
  })

  it('syncs directory updates from server', async () => {
    const stored = harness.sdk.injectObject({
      metadata: generateMockFileMetadata(1, {
        name: 'photo.jpg',
        directory: 'Trip',
      }),
    })

    let fileId: string | undefined
    await waitForCondition(
      async () => {
        const files = await readAllFileRecords({ order: 'ASC' })
        if (files.length === 1) {
          fileId = files[0].id
          const dir = await readDirectoryNameForFile(files[0].id)
          return dir === 'Trip'
        }
        return false
      },
      { timeout: 10_000, message: 'Initial directory to sync' },
    )

    harness.sdk.injectMetadataChange(stored.id, { directory: 'Vacation' })

    await waitForCondition(
      async () => {
        const dir = await readDirectoryNameForFile(fileId!)
        return dir === 'Vacation'
      },
      { timeout: 10_000, message: 'Updated directory to sync' },
    )

    const dirs = await readAllDirectoriesWithCounts()
    const vacationDir = dirs.find((d) => d.name === 'Vacation')
    expect(vacationDir).toBeDefined()
    expect(vacationDir!.fileCount).toBe(1)
  })
})
