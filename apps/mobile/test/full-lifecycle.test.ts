/**
 * Tests complete file lifecycle from import through upload, sync, and deletion.
 */

import './utils/setup'

import { decodeFileMetadata } from '@siastorage/core/encoding/fileMetadata'
import { setSyncUpCursor } from '../src/managers/syncUpMetadata'
import { readFileRecord, updateFileRecord } from '../src/stores/files'
import { readLocalObjectsForFile } from '../src/stores/localObjects'
import { getUploadState } from '../src/stores/uploads'
import {
  type AppCoreHarness,
  addTestFilesToHarness,
  createHarness,
  generateTestFilesFromAssets,
} from './utils/harness'
import { TEST_ASSETS_DIR } from './utils/setup'
import { waitForCondition } from './utils/waitFor'

describe('Full File Lifecycle', () => {
  let harness: AppCoreHarness

  beforeEach(async () => {
    harness = createHarness()
    await harness.start()
    // Reset sync up cursor for clean state
    await setSyncUpCursor(undefined)
  })

  afterEach(async () => {
    await harness.shutdown()
  })

  /**
   * Complete journey: import -> upload -> edit -> sync -> delete
   * Verifies state at each step
   */
  it('handles complete file lifecycle across local and remote', async () => {
    // STEP 1: User imports photo from camera roll (using real image)
    const [file] = await addTestFilesToHarness(
      harness,
      generateTestFilesFromAssets(TEST_ASSETS_DIR, ['test-image-1.png']),
    )

    // Verify: File in DB, not yet uploaded
    let dbFile = await readFileRecord(file.id)
    expect(dbFile).not.toBeNull()
    expect(dbFile!.name).toBe('test-image-1.png')
    let objects = await readLocalObjectsForFile(file.id)
    expect(objects).toHaveLength(0)

    // Wait for scanner to detect the file
    await waitForCondition(() => getUploadState(file.id) !== undefined, {
      timeout: 10_000,
      message: 'File to be detected by scanner',
    })

    // STEP 2: Upload completes automatically
    await harness.waitForNoActiveUploads()

    // Verify: File has remote object
    objects = await readLocalObjectsForFile(file.id)
    expect(objects).toHaveLength(1)
    const objectId = objects[0].id

    // STEP 3: User renames file
    await updateFileRecord({ id: file.id, name: 'beach-sunset.png' })

    // Wait for syncUpMetadata service to push the change (runs every 2s)
    await waitForCondition(
      () => {
        const remote = harness.sdk
          .getStoredObjects()
          .find((o) => o.id === objectId)
        return (
          remote !== undefined &&
          decodeFileMetadata(remote.metadata).name === 'beach-sunset.png'
        )
      },
      { timeout: 10_000, message: 'Remote to have updated name' },
    )

    // Verify: Both local and remote have new name
    dbFile = await readFileRecord(file.id)
    expect(dbFile!.name).toBe('beach-sunset.png')
    const remote = harness.sdk
      .getStoredObjects()
      .find((o) => o.id === objectId)!
    expect(decodeFileMetadata(remote.metadata).name).toBe('beach-sunset.png')

    // STEP 4: User deletes file on another device
    harness.sdk.injectDeleteEvent(objectId)

    // Wait for syncDownEvents service to process the deletion
    await waitForCondition(
      async () => {
        const deletedFile = await readFileRecord(file.id)
        return deletedFile === null
      },
      { timeout: 10_000, message: 'File to be deleted' },
    )

    // Verify: File removed everywhere
    dbFile = await readFileRecord(file.id)
    expect(dbFile).toBeNull()
    objects = await readLocalObjectsForFile(file.id)
    expect(objects).toHaveLength(0)
    // The file's object should be gone from remote
    const deletedRemote = harness.sdk
      .getStoredObjects()
      .find((o) => o.id === objectId)
    expect(deletedRemote).toBeUndefined()
  }, 60_000)

  /**
   * Scenario: Working with multiple files, some edited remotely
   * Verifies selective sync doesn't affect unrelated files
   */
  it('handles selective remote edits across multiple files', async () => {
    // Upload 3 real image files
    const testFiles = await addTestFilesToHarness(
      harness,
      generateTestFilesFromAssets(TEST_ASSETS_DIR, [
        'test-image-1.png',
        'test-image-2.png',
        'test-image-3.png',
      ]),
    )

    // Wait for scanner to detect all files
    await waitForCondition(
      () => testFiles.every((f) => getUploadState(f.id) !== undefined),
      { timeout: 10_000, message: 'Files to be detected by scanner' },
    )

    // Wait for upload to complete
    await harness.waitForNoActiveUploads()

    // Verify initial state - each file should have a remote object
    for (const f of testFiles) {
      const objects = await readLocalObjectsForFile(f.id)
      expect(objects).toHaveLength(1)
    }

    // Remote device edits only file 2
    const objects1 = await readLocalObjectsForFile(testFiles[1].id)
    harness.sdk.injectMetadataChange(objects1[0].id, {
      name: 'renamed-remotely.png',
      updatedAt: Date.now() + 1000,
    })

    // Wait for syncDownEvents service to apply the change
    await waitForCondition(
      async () => {
        const file1 = await readFileRecord(testFiles[1].id)
        return file1?.name === 'renamed-remotely.png'
      },
      { timeout: 10_000, message: 'File 2 to be renamed' },
    )

    // Verify: Only file 2 changed, others untouched
    const file0 = await readFileRecord(testFiles[0].id)
    const file1 = await readFileRecord(testFiles[1].id)
    const file2 = await readFileRecord(testFiles[2].id)

    expect(file0!.name).toBe('test-image-1.png') // unchanged
    expect(file1!.name).toBe('renamed-remotely.png') // changed
    expect(file2!.name).toBe('test-image-3.png') // unchanged
  }, 60_000)
})
