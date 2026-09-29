import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
