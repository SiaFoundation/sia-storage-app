/**
 * Verifies concurrent thumbnail generation doesn't create duplicates.
 */

import './utils/setup'

import { generateThumbnailsForFile } from '../src/managers/thumbnailer'
import { readFileRecord } from '../src/stores/files'
import { readThumbnailsByHash } from '../src/stores/thumbnails'
import {
  type AppCoreHarness,
  addTestFilesToHarness,
  createHarness,
  generateTestFilesFromAssets,
} from './utils/harness'
import { TEST_ASSETS_DIR } from './utils/setup'
import { sleep } from './utils/waitFor'

describe('Regression: Thumbnail Scanner Race Condition', () => {
  let harness: AppCoreHarness

  beforeEach(async () => {
    harness = createHarness()
    await harness.start()
  })

  afterEach(async () => {
    await harness.shutdown()
  })

  it('thumbnail scanner skips files being processed', async () => {
    // Add an image file
    const fileFactories = generateTestFilesFromAssets(TEST_ASSETS_DIR, [
      'test-image-3.png',
    ])
    const files = await addTestFilesToHarness(harness, fileFactories)
    const fileId = files[0].id
    const fileHash = files[0].hash

    // Get the file record
    const fileRecord = await readFileRecord(fileId)
    expect(fileRecord).not.toBeNull()

    // Start manual thumbnail generation
    const manualPromise = generateThumbnailsForFile(fileRecord!)

    // Immediately wait a bit to let scanner potentially also start
    // BUG: Without fix, scanner might also start generating
    // resulting in race condition
    await sleep(500)

    await manualPromise

    // Wait for any scanner activity to settle
    await sleep(2000)

    // Check only one set of thumbnails exists
    const thumbnails = await readThumbnailsByHash(fileHash)
    // Should have expected count, not duplicates
    // Each thumbnail size should appear at most once
    const sizeCount = new Map<number, number>()
    for (const thumb of thumbnails) {
      const size = thumb.thumbSize ?? 0
      sizeCount.set(size, (sizeCount.get(size) ?? 0) + 1)
    }

    // No size should appear more than once (no duplicates)
    for (const [, count] of sizeCount.entries()) {
      expect(count).toBeLessThanOrEqual(1)
    }

    // Should have at most 2 thumbnails (64px and 512px) or 3 if there's another size
    expect(thumbnails.length).toBeLessThanOrEqual(3)
  }, 30_000)
})
