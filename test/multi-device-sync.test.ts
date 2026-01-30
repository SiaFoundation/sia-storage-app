/**
 * Tests multi-device sync scenarios including conflict resolution and deduplication.
 */

import './utils/setup'

import { getSyncDownCursor } from '../src/managers/syncDownEvents'
import { readAllFileRecords, readFileRecord } from '../src/stores/files'
import { readLocalObjectsForFile } from '../src/stores/localObjects'
import { getUploadState } from '../src/stores/uploads'
import {
  type AppCoreHarness,
  addTestFilesToHarness,
  createHarness,
  generateTestFilesFromAssets,
} from './utils/harness'
import { generateMockFileMetadata } from './utils/mockSdk'
import { TEST_ASSETS_DIR } from './utils/setup'
import { waitForCondition } from './utils/waitFor'

describe('Multi-Device Sync', () => {
  let harness: AppCoreHarness

  beforeEach(async () => {
    harness = createHarness()
    await harness.start()
  })

  afterEach(async () => {
    await harness.shutdown()
  })

  /**
   * Scenario: User uploads same photo from two devices simultaneously
   * The file should be deduplicated by content hash
   */
  it('deduplicates files added from multiple devices', async () => {
    // Device A adds a real image file locally
    const [file] = await addTestFilesToHarness(
      harness,
      generateTestFilesFromAssets(TEST_ASSETS_DIR, ['test-image-1.png']),
    )

    // Before upload completes, Device B uploads same content to server
    harness.sdk.injectObject({
      metadata: {
        ...generateMockFileMetadata(1),
        hash: file.hash,
        name: 'IMG_from_phone.png',
      },
    })

    // Wait for syncDownEvents service to pick up Device B's upload (runs every 2s)
    // This should deduplicate by hash and cancel the local upload
    await waitForCondition(
      async () => {
        const objects = await readLocalObjectsForFile(file.id)
        return objects.length > 0
      },
      { timeout: 10_000, message: 'File to have a synced object' },
    )

    // Verify: Should have exactly 1 non-thumbnail file (deduplicated by hash)
    const allFiles = await readAllFileRecords({ order: 'ASC' })
    const files = allFiles.filter((f) => !f.thumbForHash)
    expect(files).toHaveLength(1)

    // The file should have a local object now
    const objects = await readLocalObjectsForFile(file.id)
    expect(objects).toHaveLength(1)

    // Local upload should be cancelled since server already has it
    const uploadState = getUploadState(file.id)
    expect(uploadState).toBeUndefined()
  }, 30_000)

  /**
   * Scenario: User edits file on desktop, then edits on phone
   * Newest edit wins when syncing
   */
  it('resolves conflicts using newest-wins strategy', async () => {
    // Upload a real image file
    const [file] = await addTestFilesToHarness(
      harness,
      generateTestFilesFromAssets(TEST_ASSETS_DIR, ['test-image-1.png']),
    )

    // Wait for scanner to detect the file
    await waitForCondition(() => getUploadState(file.id) !== undefined, {
      timeout: 10_000,
      message: 'File to be detected by scanner',
    })

    // Wait for upload to complete
    await harness.waitForNoActiveUploads()
    const localObjects = await readLocalObjectsForFile(file.id)
    const objectId = localObjects[0].id

    // Read current file to get updatedAt
    const currentFile = await readFileRecord(file.id)
    const T1 = currentFile!.updatedAt

    // T2: Phone edits on server (happens after desktop, T2 > T1)
    const T2 = T1 + 5000
    harness.sdk.injectMetadataChange(objectId, {
      name: 'phone-edit.png',
      updatedAt: T2,
    })

    // Wait for syncDownEvents service to apply the remote change
    await waitForCondition(
      async () => {
        const dbFile = await readFileRecord(file.id)
        return dbFile?.name === 'phone-edit.png'
      },
      { timeout: 10_000, message: 'Phone edit to sync down' },
    )

    // Verify: Phone edit wins (it's newer)
    const dbFile = await readFileRecord(file.id)
    expect(dbFile!.name).toBe('phone-edit.png')
    expect(dbFile!.updatedAt).toBe(T2)
  }, 30_000)

  /**
   * Scenario: User deletes file on phone
   * Desktop should see the deletion after sync
   */
  it('syncs file deletions from other devices', async () => {
    // Upload a real image file
    const [file] = await addTestFilesToHarness(
      harness,
      generateTestFilesFromAssets(TEST_ASSETS_DIR, ['test-image-1.png']),
    )

    // Wait for scanner to detect the file
    await waitForCondition(() => getUploadState(file.id) !== undefined, {
      timeout: 10_000,
      message: 'File to be detected by scanner',
    })

    // Wait for upload to complete
    await harness.waitForNoActiveUploads()
    const localObjects = await readLocalObjectsForFile(file.id)
    const objectId = localObjects[0].id

    // Verify file exists
    expect(await readFileRecord(file.id)).not.toBeNull()

    // Phone deletes the file
    harness.sdk.injectDeleteEvent(objectId)

    // Wait for syncDownEvents service to process the deletion
    await waitForCondition(
      async () => {
        const dbFile = await readFileRecord(file.id)
        return dbFile === null
      },
      { timeout: 10_000, message: 'File to be deleted' },
    )

    // Verify: File removed locally
    expect(await readFileRecord(file.id)).toBeNull()
    const objects = await readLocalObjectsForFile(file.id)
    expect(objects).toHaveLength(0)
  }, 30_000)

  /**
   * Scenario: User was offline, comes back to find many new files
   * Verifies cursor-based sync catches up correctly
   */
  it('catches up on events after being offline', async () => {
    // Simulate: while user was offline, other devices added 5 files
    for (let i = 1; i <= 5; i++) {
      harness.sdk.injectObject({
        metadata: generateMockFileMetadata(i, { name: `new-file-${i}.png` }),
      })
    }

    // Wait for syncDownEvents service to catch up on all files (runs every 2s)
    await waitForCondition(
      async () => {
        const files = await readAllFileRecords({ order: 'ASC' })
        return files.length === 5
      },
      { timeout: 10_000, message: 'All 5 files to sync' },
    )

    // Verify: All 5 files synced
    const files = await readAllFileRecords({ order: 'ASC' })
    expect(files).toHaveLength(5)

    // Verify file names
    const names = files.map((f) => f.name).sort()
    expect(names).toEqual([
      'new-file-1.png',
      'new-file-2.png',
      'new-file-3.png',
      'new-file-4.png',
      'new-file-5.png',
    ])

    // Cursor should be set after syncing
    const cursor = await getSyncDownCursor()
    expect(cursor?.id).toBeDefined()
  }, 30_000)
})
