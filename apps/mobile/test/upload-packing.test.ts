/**
 * Upload packing integration tests.
 *
 * These tests use the core test harness with real DB, real filesystem,
 * and real timers (shortened via test config) to verify end-to-end
 * packing efficiency across complex multi-slab, multi-flush scenarios.
 *
 * Test config (from setup.ts):
 *   SLAB_SIZE       = 10 KB  (10240 bytes)
 *   PACKER_MAX_SLABS = 10    (→ max ~100 KB per batch)
 *   PACKER_IDLE_TIMEOUT = 1000 ms
 *   PACKER_POLL_INTERVAL = 1000 ms
 *   SLAB_FILL_THRESHOLD = 0.9
 *
 * fillPercent formula:
 *   Math.round((totalSize / ((slabsFilled + 1) * SLAB_SIZE)) * 100)
 *
 * DB polling returns files ordered by createdAt ASC (then id ASC for
 * tiebreaking), making the processing order deterministic: files are
 * processed in wave insertion order.
 */

import './utils/setup'

import type { FlushRecord } from '../src/managers/uploader'
import { getUploadManager } from '../src/managers/uploader'
import {
  type AppCoreHarness,
  addTestFilesToHarness,
  createHarness,
  generateTestFiles,
} from './utils/harness'

function getFlushHistory(): FlushRecord[] {
  return getUploadManager().flushHistory
}

describe('Upload Packing', () => {
  let harness: AppCoreHarness

  beforeEach(async () => {
    harness = createHarness()
    await harness.start()
  })

  afterEach(async () => {
    await harness.shutdown()
  })

  it('complex multi-wave scenario across many slabs and flushes', async () => {
    // SLAB_SIZE = 10240 bytes, PACKER_MAX_SLABS = 10 → batch max ≈ 100KB
    // This test feeds files across multiple waves, forcing threshold
    // flushes and max_slabs flushes, then verifies each was efficient.
    //
    // createdAt-ordered polling processes files in wave order:
    //   40 × 200b → 20 × 2000b → 10 × 8000b → 30 × 100b

    // Wave 1: 40 small files × 200 bytes = 8000 bytes
    const wave1 = generateTestFiles(40, { startId: 1, sizeBytes: 200 })
    await addTestFilesToHarness(harness, wave1)

    // Wave 2: 20 medium files × 2000 bytes = 40000 bytes
    const wave2 = generateTestFiles(20, { startId: 100, sizeBytes: 2000 })
    await addTestFilesToHarness(harness, wave2)

    // Wave 3: 10 larger files × 8000 bytes = 80000 bytes
    const wave3 = generateTestFiles(10, { startId: 200, sizeBytes: 8000 })
    await addTestFilesToHarness(harness, wave3)

    // Wave 4: 30 tiny files × 100 bytes = 3000 bytes
    const wave4 = generateTestFiles(30, { startId: 300, sizeBytes: 100 })
    await addTestFilesToHarness(harness, wave4)

    await harness.waitForNoActiveUploads(120_000)

    const history = getFlushHistory()

    // 8 flushes total
    expect(history).toHaveLength(8)

    // Flush 0: 40 × 200b + 1 × 2000b = 10000b → threshold at slab boundary
    expect(history[0]).toMatchObject({
      reason: 'slab_threshold',
      fileCount: 41,
      slabsFilled: 0,
      fillPercent: 98,
    })

    // Flushes 1-3: 5 × 2000b = 10000b each → threshold
    for (let i = 1; i <= 3; i++) {
      expect(history[i]).toMatchObject({
        reason: 'slab_threshold',
        fileCount: 5,
        slabsFilled: 0,
        fillPercent: 98,
      })
    }

    // Flush 4: 4 × 2000b + 4 × 8000b = 40000b → threshold at 4 slabs
    expect(history[4]).toMatchObject({
      reason: 'slab_threshold',
      fileCount: 8,
      slabsFilled: 3,
      fillPercent: 98,
    })

    // Flush 5: 5 × 8000b = 40000b → threshold at 4 slabs
    expect(history[5]).toMatchObject({
      reason: 'slab_threshold',
      fileCount: 5,
      slabsFilled: 3,
      fillPercent: 98,
    })

    // Flush 6: 1 × 8000b + 22 × 100b = 10200b → threshold at slab boundary
    expect(history[6]).toMatchObject({
      reason: 'slab_threshold',
      fileCount: 23,
      slabsFilled: 0,
      fillPercent: 100,
    })

    // Flush 7: 8 × 100b = 800b → idle timeout drains remainder
    expect(history[7]).toMatchObject({
      reason: 'idle_timeout',
      fileCount: 8,
      slabsFilled: 0,
      fillPercent: 8,
    })

    const totalFiles = history.reduce((sum, h) => sum + h.fileCount, 0)
    expect(totalFiles).toBe(100)
    expect(harness.sdk.getStoredObjects()).toHaveLength(100)
  }, 120_000)

  it('files arriving in waves — all packed before flush', async () => {
    // Wave 1: 3 × 500b, wave 2: 3 × 500b shortly after
    // Total: 3000b — well under one slab, all pack into one batch
    const wave1 = generateTestFiles(3, { startId: 1, sizeBytes: 500 })
    await addTestFilesToHarness(harness, wave1)

    await new Promise((r) => setTimeout(r, 500))

    const wave2 = generateTestFiles(3, { startId: 10, sizeBytes: 500 })
    await addTestFilesToHarness(harness, wave2)

    await harness.waitForNoActiveUploads(30_000)

    const history = getFlushHistory()

    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      reason: 'idle_timeout',
      fileCount: 6,
      slabsFilled: 0,
      fillPercent: 29,
    })

    expect(harness.sdk.getStoredObjects()).toHaveLength(6)
  }, 60_000)

  it('steady stream of mixed sizes across many flush cycles', async () => {
    // Simulates a camera roll import: thumbnails, photos, and videos.
    // createdAt-ordered polling processes files in wave order:
    //   100 × 50b → 30 × 3000b → 5 × 9000b → 50 × 50b
    //
    // SLAB_SIZE = 10240, so:
    //   Thumbnails: 50 bytes (200 per slab)
    //   Photos: 3000 bytes (~3 per slab)
    //   Videos: 9000 bytes (~0.9 slabs each)

    // 100 thumbnails = 5000 bytes
    const thumbs = generateTestFiles(100, { startId: 1, sizeBytes: 50 })
    await addTestFilesToHarness(harness, thumbs)

    // 30 photos = 90000 bytes
    const photos = generateTestFiles(30, { startId: 200, sizeBytes: 3000 })
    await addTestFilesToHarness(harness, photos)

    // 5 videos = 45000 bytes
    const videos = generateTestFiles(5, { startId: 400, sizeBytes: 9000 })
    await addTestFilesToHarness(harness, videos)

    // 50 more thumbnails = 2500 bytes
    const moreThumb = generateTestFiles(50, { startId: 500, sizeBytes: 50 })
    await addTestFilesToHarness(harness, moreThumb)

    await harness.waitForNoActiveUploads(120_000)

    const history = getFlushHistory()

    // 6 flushes total
    expect(history).toHaveLength(6)

    // Flush 0: 100 thumbs + 5 photos = 5000 + 15000 = 20000b → threshold at 2 slabs
    expect(history[0]).toMatchObject({
      reason: 'slab_threshold',
      fileCount: 105,
      slabsFilled: 1,
      fillPercent: 98,
    })

    // Flush 1: 10 photos = 30000b → threshold at 3 slabs
    expect(history[1]).toMatchObject({
      reason: 'slab_threshold',
      fileCount: 10,
      slabsFilled: 2,
      fillPercent: 98,
    })

    // Flush 2: 10 photos = 30000b → threshold at 3 slabs
    expect(history[2]).toMatchObject({
      reason: 'slab_threshold',
      fileCount: 10,
      slabsFilled: 2,
      fillPercent: 98,
    })

    // Flush 3: 5 photos + 4 videos = 15000 + 36000 = 51000b → threshold at 5 slabs
    expect(history[3]).toMatchObject({
      reason: 'slab_threshold',
      fileCount: 9,
      slabsFilled: 4,
      fillPercent: 100,
    })

    // Flush 4: 1 video + 24 thumbs = 9000 + 1200 = 10200b → threshold at slab boundary
    expect(history[4]).toMatchObject({
      reason: 'slab_threshold',
      fileCount: 25,
      slabsFilled: 0,
      fillPercent: 100,
    })

    // Flush 5: 26 thumbs = 1300b → idle timeout drains remainder
    expect(history[5]).toMatchObject({
      reason: 'idle_timeout',
      fileCount: 26,
      slabsFilled: 0,
      fillPercent: 13,
    })

    const totalFiles = history.reduce((sum, h) => sum + h.fileCount, 0)
    expect(totalFiles).toBe(185)
    expect(harness.sdk.getStoredObjects()).toHaveLength(185)
  }, 120_000)
})
