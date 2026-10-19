import type { ThumbnailAdapter, ThumbnailResult } from '@siastorage/core/adapters'
import type { MimeType } from '@siastorage/core/lib/fileTypes'
import { type Orientation, readOrientation } from './imageOrientation'

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

function localPath(filePath: string): string {
  return filePath.replace(/^file:\/\//, '')
}

async function resizeToWebp(
  path: string,
  size: number,
  orientation: Orientation | null,
): Promise<ThumbnailResult> {
  // Bun's own autoOrient covers JPEG. It is off where the turn comes from the
  // file, so a Bun that starts orienting these formats cannot turn them twice.
  let image = Bun.file(path).image(orientation ? { autoOrient: false } : undefined)
  if (orientation?.rotate) image = image.rotate(orientation.rotate)
  if (orientation?.flop) image = image.flop()
  const buf = await image
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
    async generateImageThumbnail(sourcePath: string, targetSize: number) {
      const path = localPath(sourcePath)
      return resizeToWebp(path, targetSize, await readOrientation(path))
    },
    async generateImageThumbnails(sourcePath: string, sizes: number[]) {
      const path = localPath(sourcePath)
      const orientation = await readOrientation(path)
      const results = new Map<number, ThumbnailResult>()
      for (const size of sizes) {
        results.set(size, await resizeToWebp(path, size, orientation))
      }
      return results
    },
    async generateVideoThumbnail(): Promise<ThumbnailResult> {
      throw new Error('Video thumbnails not supported')
    },
  }
}
