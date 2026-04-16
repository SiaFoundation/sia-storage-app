import type { ThumbnailAdapter, ThumbnailResult } from '@siastorage/core/adapters'
import type { MimeType } from '@siastorage/core/lib/fileTypes'

const WEBP_QUALITY = 80

// Image MIMEs that Bun.Image (libvips) can decode. Video unsupported in this
// adapter (generateVideoThumbnail throws), so video MIMEs are absent.
const BUN_THUMBNAILABLE_TYPES: readonly string[] = [
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
  const buf = await Bun.file(path)
    .image()
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .buffer()
  return {
    data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    mimeType: 'image/webp',
  }
}

/**
 * Thumbnail adapter backed by `Bun.Image`. Bun bundles libvips directly, so
 * `bun build --compile` produces a single binary with no native-addon dance.
 */
export function createBunThumbnailAdapter(): ThumbnailAdapter {
  return {
    thumbnailableTypes: BUN_THUMBNAILABLE_TYPES,
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
