import type { ThumbnailAdapter, ThumbnailResult } from '@siastorage/core/adapters'
import sharp from 'sharp'

export function createSharpThumbnailAdapter(): ThumbnailAdapter {
  return {
    async generateImageThumbnail(sourcePath: string, targetSize: number): Promise<ThumbnailResult> {
      const filePath = sourcePath.replace(/^file:\/\//, '')
      const buf: Buffer = await sharp(filePath)
        .resize(targetSize, targetSize, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer()
      return {
        data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
        mimeType: 'image/webp',
      }
    },

    async generateImageThumbnails(
      sourcePath: string,
      sizes: number[],
    ): Promise<Map<number, ThumbnailResult>> {
      const results = new Map<number, ThumbnailResult>()
      for (const size of sizes) {
        const filePath = sourcePath.replace(/^file:\/\//, '')
        const buf: Buffer = await sharp(filePath)
          .resize(size, size, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer()
        results.set(size, {
          data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
          mimeType: 'image/webp',
        })
      }
      return results
    },

    async generateVideoThumbnail(): Promise<ThumbnailResult> {
      throw new Error('Video thumbnails not supported')
    },
  }
}
