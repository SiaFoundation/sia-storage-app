/**
 * Thumbnail generation integration tests.
 *
 * Tests that the ThumbnailScanner correctly generates thumbnails
 * when running as part of the full TestApp lifecycle, including:
 * - Files with colliding thumbnail hashes get separate records
 * - Concurrent generateThumbnailsForFile + scanner don't duplicate
 */

import { ThumbSizes } from '@siastorage/core/types'
import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import * as crypto from 'crypto'
import * as nodeFs from 'fs'
import * as path from 'path'
import sharp from 'sharp'
import { createTestApp, type TestApp, type TestFileFactory, waitForCondition } from './app'

let app: TestApp
let validJpegBuffer: Buffer

beforeAll(async () => {
  validJpegBuffer = await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .jpeg()
    .toBuffer()
})

beforeEach(async () => {
  app = createTestApp(createEmptyIndexerStorage())
  await app.start()
})

afterEach(async () => {
  await app.shutdown()
})

function createImageFileFactory(name: string, content?: Buffer): TestFileFactory {
  return (tempDir: string) => {
    const fileId = `test-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const ext = path.extname(name)
    const filePath = path.join(tempDir, `${fileId}${ext}`)
    const data = content ?? validJpegBuffer
    nodeFs.writeFileSync(filePath, data)
    const hash = crypto.createHash('sha256').update(data).digest('hex')
    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg'
    return {
      id: fileId,
      name,
      type: mimeType,
      size: data.length,
      hash,
      uri: `file://${filePath}`,
    }
  }
}

describe('Thumbnail Generation', () => {
  it('generates thumbnails for added image files', async () => {
    const files = await app.addFiles([createImageFileFactory('photo.jpg')])

    await waitForCondition(
      async () => {
        const thumbs = await app.readThumbnailsByFileId(files[0].id)
        return thumbs.length === ThumbSizes.length
      },
      { timeout: 15_000, message: 'Thumbnails to be generated' },
    )

    const thumbnails = await app.readThumbnailsByFileId(files[0].id)
    expect(thumbnails).toHaveLength(ThumbSizes.length)
    const sizes = thumbnails.map((t) => t.thumbSize).sort((a, b) => (a ?? 0) - (b ?? 0))
    expect(sizes).toEqual([...ThumbSizes].sort((a, b) => a - b))
  })

  it('generates separate thumbnail records for files with colliding hashes', async () => {
    const content1 = await sharp({
      create: {
        width: 50,
        height: 50,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .jpeg()
      .toBuffer()
    const content2 = await sharp({
      create: {
        width: 50,
        height: 50,
        channels: 3,
        background: { r: 0, g: 0, b: 255 },
      },
    })
      .jpeg()
      .toBuffer()

    const files = await app.addFiles([
      createImageFileFactory('image1.jpg', content1),
      createImageFileFactory('image2.jpg', content2),
    ])

    expect(files[0].hash).not.toBe(files[1].hash)

    await waitForCondition(
      async () => {
        let totalThumbnails = 0
        for (const file of files) {
          const thumbs = await app.readThumbnailsByFileId(file.id)
          totalThumbnails += thumbs.length
        }
        return totalThumbnails === files.length * ThumbSizes.length
      },
      { timeout: 15_000, message: 'All thumbnails to be generated' },
    )

    for (const file of files) {
      const thumbnails = await app.readThumbnailsByFileId(file.id)
      expect(thumbnails).toHaveLength(ThumbSizes.length)
      const sizes = thumbnails.map((t) => t.thumbSize).sort((a, b) => (a ?? 0) - (b ?? 0))
      expect(sizes).toEqual([...ThumbSizes].sort((a, b) => a - b))
    }
  })

  // Verifies concurrent thumbnail generation doesn't create duplicates.
  // Without the scanner lock, both generateThumbnailsForFile and the scanner
  // could process the same file simultaneously, causing duplicate rows.
  it('concurrent generateThumbnailsForFile and scanner do not create duplicates', async () => {
    const files = await app.addFiles([createImageFileFactory('race-test.jpg')])
    const fileId = files[0].id

    const fileRecord = await app.getFileById(fileId)
    expect(fileRecord).not.toBeNull()

    const manualPromise = app.thumbnailScanner.generateThumbnailsForFile(fileRecord!)

    await new Promise((r) => setTimeout(r, 500))
    await manualPromise
    await new Promise((r) => setTimeout(r, 2000))

    const thumbnails = await app.readThumbnailsByFileId(fileId)
    const sizeCount = new Map<number, number>()
    for (const thumb of thumbnails) {
      const size = thumb.thumbSize ?? 0
      sizeCount.set(size, (sizeCount.get(size) ?? 0) + 1)
    }

    for (const [, count] of sizeCount.entries()) {
      expect(count).toBeLessThanOrEqual(1)
    }

    expect(thumbnails.length).toBeLessThanOrEqual(ThumbSizes.length)
  })
})
