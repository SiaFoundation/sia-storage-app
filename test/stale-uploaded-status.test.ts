/**
 * Bug 1: Stale `isUploaded` Status (d007bd4c)
 *
 * Problem: After upload completes, `useFileStatus` returned stale data
 * because it used `file.objects` from props instead of querying fresh
 * data from the database.
 *
 * Symptom: `isUploaded: false` immediately after upload completes,
 * even though object exists in DB.
 */

import './utils/setup'

import { fileHasASealedObject } from '../src/lib/file'
import { readFileRecord } from '../src/stores/files'
import { readLocalObjectsForFile } from '../src/stores/localObjects'
import { getUploadState } from '../src/stores/uploads'
import {
  type AppCoreHarness,
  addTestFilesToHarness,
  createHarness,
  generateTestFiles,
} from './utils/harness'
import { waitForCondition } from './utils/waitFor'

describe('Regression: Stale isUploaded Status', () => {
  let harness: AppCoreHarness

  beforeEach(async () => {
    harness = createHarness()
    await harness.start()
  })

  afterEach(async () => {
    await harness.shutdown()
  })

  it('isUploaded reflects fresh data immediately after upload', async () => {
    const fileFactories = generateTestFiles(1)
    const files = await addTestFilesToHarness(harness, fileFactories)
    const fileId = files[0].id

    // Wait for scanner to detect files first
    await waitForCondition(
      () => {
        const state = getUploadState(fileId)
        return state !== undefined
      },
      { timeout: 10_000, message: 'File to be detected by scanner' },
    )

    // Wait for upload to complete
    await harness.waitForNoActiveUploads(15_000)

    // Query file status immediately - should show uploaded
    // BUG: Without fix, file.objects is stale, so isUploaded = false
    const file = await readFileRecord(fileId)
    expect(file).not.toBeNull()

    const objects = await readLocalObjectsForFile(fileId)

    expect(objects.length).toBeGreaterThan(0)
    expect(fileHasASealedObject({ ...file!, objects: {} })).toBe(false) // No objects in record yet
    expect(
      fileHasASealedObject({
        ...file!,
        objects: Object.fromEntries(objects.map((o) => [o.indexerURL, o])),
      }),
    ).toBe(true)
  }, 30_000)
})
