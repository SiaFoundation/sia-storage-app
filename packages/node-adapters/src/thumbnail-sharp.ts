import type { ThumbnailAdapter, ThumbnailResult } from '@siastorage/core/adapters'
import sharp from 'sharp'

const WEBP_QUALITY = 80

async function resizeToWebp(filePath: string, size: number): Promise<ThumbnailResult> {
  const path = filePath.replace(/^file:\/\//, '')
  const buf = await sharp(path)
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer()
  return {
    data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    mimeType: 'image/webp',
  }
}

/**
 * Sharp-backed thumbnail adapter for Node consumers (jest workers, integration
 * tests). The CLI uses `createBunThumbnailAdapter` — sharp's libvips dlopen
 * can't survive `bun build --compile`.
 */
export function createSharpThumbnailAdapter(): ThumbnailAdapter {
  return {
    generateImageThumbnail(sourcePath: string, targetSize: number) {
      return resizeToWebp(sourcePath, targetSize)
    },
    async generateImageThumbnails(sourcePath: string, sizes: number[]) {
      const results = new Map<number, ThumbnailResult>()
      for (const size of sizes) {
        results.set(size, await resizeToWebp(sourcePath, size))
      }
      return results
    },
    async generateVideoThumbnail(): Promise<ThumbnailResult> {
      throw new Error('Video thumbnails not supported')
    },
  }
}
