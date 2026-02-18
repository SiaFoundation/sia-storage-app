/**
 * Thumbnail Generation Batch Test
 *
 * Verifies that two different images which downscale to identical thumbnails
 * each get their own thumbnail records.
 *
 * The two test images have different original content hashes but produce
 * byte-identical thumbnails when resized:
 * - 6gsjvjbe43r.jpg (hash: 31440330...)
 * - ypnclj0j49f.jpg (hash: b4c5f247...)
 * Both produce the same 64px and 512px thumbnail hashes.
 */

import './utils/setup'

import { ThumbSizes } from '../src/stores/files'
import { readThumbnailsByFileId } from '../src/stores/thumbnails'
import {
  type AppCoreHarness,
  addTestFilesToHarness,
  createHarness,
  generateTestFilesFromAssets,
} from './utils/harness'
import { CORE_TEST_ASSETS_DIR } from './utils/setup'
import { waitForCondition } from './utils/waitFor'

const FILES_SAME_THUMB_DIR = `${CORE_TEST_ASSETS_DIR}/files-same-thumb`

// These two files have different content but produce identical thumbnails
const COLLIDING_FILES = ['6gsjvjbe43r.jpg', 'ypnclj0j49f.jpg']

describe('Thumbnail Hash Collision', () => {
  let harness: AppCoreHarness

  beforeEach(async () => {
    harness = createHarness()
    await harness.start()
  })

  afterEach(async () => {
    await harness.shutdown()
  })

  it('generates thumbnails for 2 images with colliding thumbnail hashes', async () => {
    // Add the two files that produce identical thumbnails
    const files = await addTestFilesToHarness(
      harness,
      generateTestFilesFromAssets(FILES_SAME_THUMB_DIR, COLLIDING_FILES),
    )

    expect(files).toHaveLength(2)

    // Verify the original files have different hashes
    expect(files[0].hash).not.toBe(files[1].hash)

    // Wait for uploads to complete
    await harness.waitForNoActiveUploads(30_000)

    // Wait for thumbnail scanner to run: 2 files × 2 sizes = 4 thumbnails
    await waitForCondition(
      async () => {
        let totalThumbnails = 0
        for (const file of files) {
          const thumbs = await readThumbnailsByFileId(file.id)
          totalThumbnails += thumbs.length
        }
        return totalThumbnails === 4
      },
      {
        timeout: 30_000,
        message: 'All 4 thumbnails to be generated (2 files × 2 sizes)',
      },
    )

    // Verify each file has exactly 2 thumbnails
    for (const file of files) {
      const thumbnails = await readThumbnailsByFileId(file.id)
      expect(thumbnails).toHaveLength(2)

      const sizes = thumbnails.map((t) => t.thumbSize).sort()
      expect(sizes).toEqual(ThumbSizes.sort())
    }
  }, 60_000)
})
