/**
 * Tests for syncUpMetadata service - pushing local metadata changes to remote.
 */

import './utils/setup'

import { decodeFileMetadata } from '../src/encoding/fileMetadata'
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

describe('Sync Up Metadata', () => {
  let harness: AppCoreHarness

  beforeEach(async () => {
    harness = createHarness()
    await harness.start()
  })

  afterEach(async () => {
    await harness.shutdown()
  })

  /**
   * Scenario: User renames a file locally while online.
   * The syncUpMetadata service should push the rename to the remote server.
   */
  it('pushes local file rename to remote', async () => {
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
    expect(localObjects.length).toBeGreaterThan(0)
    const objectId = localObjects[0].id

    // Verify the file exists on the remote server
    const remoteBeforeRename = await harness.sdk.object(objectId)
    expect(remoteBeforeRename).toBeDefined()

    // Simulate local rename by updating the file record
    const newName = 'renamed-file.png'
    const renameTimestamp = Date.now()
    await updateFileRecord(
      { id: file.id, name: newName, updatedAt: renameTimestamp },
      true,
      { includeUpdatedAt: true },
    )

    // Wait for syncUpMetadata service (runs every 2s) to propagate the change
    await waitForCondition(
      async () => {
        const remote = await harness.sdk.object(objectId)
        const remoteMeta = decodeFileMetadata(remote.metadata())
        return remoteMeta.name === newName
      },
      { timeout: 10_000, message: 'Remote metadata to have new name' },
    )

    // Verify remote metadata has the new name
    const remoteAfterSync = await harness.sdk.object(objectId)
    const remoteMeta = decodeFileMetadata(remoteAfterSync.metadata())
    expect(remoteMeta.name).toBe(newName)
  }, 30_000)

  /**
   * Scenario: Remote has newer changes than local.
   * The syncUpMetadata service should NOT overwrite newer remote changes.
   */
  it('does not overwrite newer remote changes', async () => {
    // Upload two image files
    const [file1, file2] = await addTestFilesToHarness(
      harness,
      generateTestFilesFromAssets(TEST_ASSETS_DIR, [
        'test-image-1.png',
        'test-image-2.png',
      ]),
    )

    // Wait for uploads to complete
    await waitForCondition(() => getUploadState(file1.id) !== undefined, {
      timeout: 10_000,
      message: 'File 1 to be detected by scanner',
    })
    await waitForCondition(() => getUploadState(file2.id) !== undefined, {
      timeout: 10_000,
      message: 'File 2 to be detected by scanner',
    })
    await harness.waitForNoActiveUploads()

    const localObjects1 = await readLocalObjectsForFile(file1.id)
    const localObjects2 = await readLocalObjectsForFile(file2.id)
    expect(localObjects1.length).toBeGreaterThan(0)
    expect(localObjects2.length).toBeGreaterThan(0)
    const objectId1 = localObjects1[0].id
    const objectId2 = localObjects2[0].id

    // Read current file to get baseline updatedAt
    const currentFile1 = await readFileRecord(file1.id)
    const T1 = currentFile1!.updatedAt

    // For file 1: Inject a remote metadata change with a FUTURE timestamp
    const remoteNewerName = 'remote-edited-name.png'
    const T_remote = T1 + 10000 // 10 seconds in the future
    harness.sdk.injectMetadataChange(objectId1, {
      name: remoteNewerName,
      updatedAt: T_remote,
    })

    // Make a local edit to file 1 with an OLDER timestamp (will be ignored)
    const localOlderName = 'local-older-edit.png'
    const T_local_old = T1 + 1000 // 1 second after original, but before remote
    await updateFileRecord(
      { id: file1.id, name: localOlderName, updatedAt: T_local_old },
      true,
      { includeUpdatedAt: true },
    )

    // Make a normal local edit to file 2 (newer timestamp, should sync)
    const file2NewName = 'file2-local-rename.png'
    const T_file2 = Date.now()
    await updateFileRecord(
      { id: file2.id, name: file2NewName, updatedAt: T_file2 },
      true,
      { includeUpdatedAt: true },
    )

    // Wait for file 2's change to sync (proves the service ran)
    await waitForCondition(
      async () => {
        const remote = await harness.sdk.object(objectId2)
        const remoteMeta = decodeFileMetadata(remote.metadata())
        return remoteMeta.name === file2NewName
      },
      { timeout: 10_000, message: 'File 2 remote metadata to have new name' },
    )

    // Verify file 1's remote metadata still has the newer remote edit (wasn't overwritten)
    const remote1AfterSync = await harness.sdk.object(objectId1)
    const remoteMeta1 = decodeFileMetadata(remote1AfterSync.metadata())
    expect(remoteMeta1.name).toBe(remoteNewerName)
    expect(remoteMeta1.updatedAt).toBe(T_remote)
  }, 30_000)
})
