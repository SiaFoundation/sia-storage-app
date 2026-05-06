import type { ThumbnailResult } from '@siastorage/core/adapters'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createSharpThumbnailAdapter } from '../src/thumbnail-sharp'

function dataOf(result: ThumbnailResult): ArrayBuffer {
  if (!('data' in result)) throw new Error('expected ArrayBuffer result, got savedUri')
  return result.data
}

let tempDir: string
let adapter: ReturnType<typeof createSharpThumbnailAdapter>

let testImagePath: string

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-thumb-test-'))
  testImagePath = path.join(tempDir, 'test.png')
  const sharp = require('sharp')
  await sharp({
    create: {
      width: 200,
      height: 150,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .png()
    .toFile(testImagePath)
})

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

beforeEach(() => {
  adapter = createSharpThumbnailAdapter()
})

describe('generateImageThumbnail', () => {
  it('generates thumbnail at target size', async () => {
    const result = await adapter.generateImageThumbnail(testImagePath, 50)
    const data = dataOf(result)
    expect(data.byteLength).toBeGreaterThan(0)
    expect(result.mimeType).toBe('image/webp')

    // Verify dimensions
    const sharp = require('sharp')
    const meta = await sharp(Buffer.from(data)).metadata()
    expect(meta.width).toBeLessThanOrEqual(50)
    expect(meta.height).toBeLessThanOrEqual(50)
  })

  it('outputs WebP format', async () => {
    const result = await adapter.generateImageThumbnail(testImagePath, 50)
    const buf = Buffer.from(dataOf(result))
    // WebP starts with RIFF....WEBP
    expect(buf.slice(0, 4).toString()).toBe('RIFF')
    expect(buf.slice(8, 12).toString()).toBe('WEBP')
  })

  it('does not enlarge beyond original size', async () => {
    const result = await adapter.generateImageThumbnail(testImagePath, 1000)
    const sharp = require('sharp')
    const meta = await sharp(Buffer.from(dataOf(result))).metadata()
    expect(meta.width).toBeLessThanOrEqual(200)
    expect(meta.height).toBeLessThanOrEqual(150)
  })

  it('handles file:// prefix', async () => {
    const result = await adapter.generateImageThumbnail(`file://${testImagePath}`, 50)
    expect(dataOf(result).byteLength).toBeGreaterThan(0)
  })
})

describe('generateImageThumbnails', () => {
  it('returns Map with all requested sizes', async () => {
    const sizes = [32, 64, 128]
    const results = await adapter.generateImageThumbnails(testImagePath, sizes)
    expect(results.size).toBe(3)
    for (const size of sizes) {
      const result = results.get(size)
      expect(result).toBeDefined()
      expect(dataOf(result!).byteLength).toBeGreaterThan(0)
      expect(result!.mimeType).toBe('image/webp')
    }
  })
})

describe('generateVideoThumbnail', () => {
  it('throws with descriptive error', async () => {
    await expect(adapter.generateVideoThumbnail(testImagePath, 50)).rejects.toThrow(
      'Video thumbnails not supported',
    )
  })
})
