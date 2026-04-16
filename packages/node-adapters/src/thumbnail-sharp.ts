import type { ThumbnailAdapter, ThumbnailResult } from '@siastorage/core/adapters'
import type { MimeType } from '@siastorage/core/lib/fileTypes'
import sharp from 'sharp'

const WEBP_QUALITY = 80

// Image MIMEs that sharp (libvips) can decode. Video unsupported in this
// adapter (generateVideoThumbnail throws), so video MIMEs are absent.
const SHARP_THUMBNAILABLE_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/tiff',
  'image/avif',
  'image/heic',
  'image/heif',
  'image/svg+xml',
] as const satisfies readonly MimeType[]

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
    thumbnailableTypes: SHARP_THUMBNAILABLE_TYPES,
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
