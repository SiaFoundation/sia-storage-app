import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { createBunThumbnailAdapter } from '../../src/thumbnail'

const dir = mkdtempSync(join(tmpdir(), 'sia-bun-thumb-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** A 2x2 24-bit BMP. */
function bmp(): Uint8Array {
  const row = [0, 0, 255, 0, 255, 0, 0, 0] // two BGR pixels padded to 4 bytes
  const pixels = [...row, ...row]
  const size = 54 + pixels.length
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  out.set([0x42, 0x4d])
  view.setUint32(2, size, true)
  view.setUint32(10, 54, true)
  view.setUint32(14, 40, true)
  view.setInt32(18, 2, true)
  view.setInt32(22, 2, true)
  view.setUint16(26, 1, true)
  view.setUint16(28, 24, true)
  view.setUint32(34, pixels.length, true)
  out.set(pixels, 54)
  return out
}

/** Size and the colours at the centres of the top-left, top-right, bottom-left and bottom-right quadrants. */
async function quadrantColors(webp: ArrayBuffer) {
  const { data, info } = await sharp(Buffer.from(webp)).raw().toBuffer({ resolveWithObject: true })
  const at = (fx: number, fy: number) => {
    const x = Math.floor(info.width * fx)
    const y = Math.floor(info.height * fy)
    const o = (y * info.width + x) * info.channels
    const [r, g, b] = [data[o] > 128, data[o + 1] > 128, data[o + 2] > 128]
    return r && g && b ? 'W' : r ? 'R' : g ? 'G' : b ? 'B' : '?'
  }
  return {
    size: `${info.width}x${info.height}`,
    quadrants: at(0.25, 0.25) + at(0.75, 0.25) + at(0.25, 0.75) + at(0.75, 0.75),
  }
}

describe('the Bun thumbnail adapter', () => {
  const adapter = createBunThumbnailAdapter()

  it('lists BMP and makes a WebP thumbnail from one', async () => {
    const path = join(dir, 'a.bmp')
    writeFileSync(path, bmp())
    expect(adapter.thumbnailableTypes).toContain('image/bmp')
    const result = await adapter.generateImageThumbnail(path, 64)
    expect(result.mimeType).toBe('image/webp')
    expect('data' in result && result.data.byteLength).toBeGreaterThan(0)
  })

  // The fixtures are a 32x16 image with red, green, blue and white quadrants,
  // stored with each EXIF orientation. Each expectation is what ImageIO draws
  // for that file with kCGImageSourceCreateThumbnailWithTransform, the call
  // the iOS app makes its thumbnails with.
  it.skipIf(process.platform !== 'darwin').each([
    [1, '32x16', 'RGBW'],
    [2, '32x16', 'GRWB'],
    [3, '32x16', 'WBGR'],
    [4, '32x16', 'BWRG'],
    [5, '16x32', 'RBGW'],
    [6, '16x32', 'BRWG'],
    [7, '16x32', 'WGBR'],
    [8, '16x32', 'GWRB'],
  ])('draws a HEIC and a TIFF with orientation %d upright', async (n, size, quadrants) => {
    for (const ext of ['heic', 'tiff']) {
      const path = join(import.meta.dir, '../fixtures/orientation', `${n}.${ext}`)
      const result = await adapter.generateImageThumbnail(path, 64)
      if (!('data' in result)) throw new Error('expected thumbnail bytes')
      expect(await quadrantColors(result.data)).toEqual({ size, quadrants })
    }
  })

  it('leaves out SVG, which Bun.Image cannot decode', async () => {
    const path = join(dir, 'a.svg')
    writeFileSync(path, '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>')
    expect(adapter.thumbnailableTypes).not.toContain('image/svg+xml')
    await expect(adapter.generateImageThumbnail(path, 64)).rejects.toThrow()
  })

  it('offers TIFF, HEIC, HEIF and AVIF on macOS and Windows, which decode them with OS codecs', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const types = createBunThumbnailAdapter(platform).thumbnailableTypes
      expect(types).toEqual(
        expect.arrayContaining(['image/tiff', 'image/heic', 'image/heif', 'image/avif']),
      )
    }
  })

  it('offers only the formats with codecs built into Bun on Linux', () => {
    expect([...createBunThumbnailAdapter('linux').thumbnailableTypes].sort()).toEqual([
      'image/bmp',
      'image/gif',
      'image/jpeg',
      'image/png',
      'image/webp',
    ])
  })
})
