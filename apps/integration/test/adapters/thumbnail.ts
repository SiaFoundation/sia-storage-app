import type { ThumbnailAdapter } from '@siastorage/core/adapters'

let sharp: any
try {
  sharp = require('sharp')
} catch {
  // sharp not available
}

export function createSharpThumbnailAdapter(): ThumbnailAdapter | undefined {
  if (!sharp) return undefined
  return {
    async generateImageThumbnail(sourcePath: string, targetSize: number) {
      const filePath = sourcePath.replace('file://', '')
      const buf = await sharp(filePath)
        .resize(targetSize, targetSize, { fit: 'inside' })
        .webp({ quality: 80 })
        .toBuffer()
      return {
        data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        mimeType: 'image/webp',
      }
    },
    async generateImageThumbnails(sourcePath: string, sizes: number[]) {
      const results = new Map()
      for (const size of sizes) {
        const filePath = sourcePath.replace('file://', '')
        const buf = await sharp(filePath)
          .resize(size, size, { fit: 'inside' })
          .webp({ quality: 80 })
          .toBuffer()
        results.set(size, {
          data: buf.buffer.slice(
            buf.byteOffset,
            buf.byteOffset + buf.byteLength,
          ),
          mimeType: 'image/webp',
        })
      }
      return results
    },
    async generateVideoThumbnail() {
      const placeholder = Buffer.alloc(64)
      return {
        data: placeholder.buffer.slice(
          placeholder.byteOffset,
          placeholder.byteOffset + placeholder.byteLength,
        ),
        mimeType: 'image/webp',
      }
    },
  }
}

export function createMockThumbnailAdapter(
  overrides?: Partial<ThumbnailAdapter>,
): ThumbnailAdapter {
  return {
    async generateImageThumbnail() {
      return { data: new ArrayBuffer(64), mimeType: 'image/webp' }
    },
    async generateImageThumbnails(_sourcePath: string, sizes: number[]) {
      const results = new Map()
      for (const size of sizes) {
        results.set(size, { data: new ArrayBuffer(64), mimeType: 'image/webp' })
      }
      return results
    },
    async generateVideoThumbnail() {
      return { data: new ArrayBuffer(64), mimeType: 'image/webp' }
    },
    ...overrides,
  }
}
