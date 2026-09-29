import type { ThumbnailAdapter, ThumbnailResult } from '@siastorage/core/adapters'
import type { MimeType } from '@siastorage/core/lib/fileTypes'

const WEBP_QUALITY = 80

// Image MIMEs Bun.Image decodes on every platform. JPEG, PNG and WebP use
// codecs compiled into Bun. BMP and GIF use a decoder built into Bun on Linux
// and the OS codecs on macOS and Windows. It has no SVG decoder, unlike sharp.
// Video is absent because generateVideoThumbnail throws.
const EVERY_PLATFORM_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/bmp',
  'image/webp',
] as const satisfies readonly MimeType[]

// Bun.Image decodes these through the OS image codecs, ImageIO on macOS and
// WIC on Windows. A Linux build has neither and rejects them with
// ERR_IMAGE_FORMAT_UNSUPPORTED, so listing them there would fail every such
// file. On Windows HEIC and AVIF decode only where the OS has those codecs,
// and a machine without them fails each such file's thumbnail. HEIF shares
// HEIC's container.
const OS_CODEC_TYPES = [
  'image/tiff',
  'image/avif',
  'image/heic',
  'image/heif',
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
 * Thumbnail adapter backed by `Bun.Image`, which is compiled into Bun, so
 * `bun build --compile` produces a single binary with no native addon to ship.
 * `platform` picks which formats it offers to thumbnail.
 */
export function createBunThumbnailAdapter(
  platform: NodeJS.Platform = process.platform,
): ThumbnailAdapter {
  return {
    thumbnailableTypes:
      platform === 'linux' ? EVERY_PLATFORM_TYPES : [...EVERY_PLATFORM_TYPES, ...OS_CODEC_TYPES],
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
