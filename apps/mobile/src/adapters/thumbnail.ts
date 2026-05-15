import type { ThumbnailAdapter, ThumbnailResult } from '@siastorage/core/adapters'
import type { MimeType } from '@siastorage/core/lib/fileTypes'
import type { ThumbSize } from '@siastorage/core/types'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import * as VideoThumbnails from 'expo-video-thumbnails'
import { Image } from 'react-native'
import { getOsThumbnail } from 'sia-os-thumb'

function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject)
  })
}

/**
 * Resize an image to fit within maxSize while preserving aspect ratio,
 * applying EXIF orientation correction if needed.
 *
 * For the source image (first call), we detect EXIF rotation by comparing
 * Image.getSize (EXIF-corrected) against the raw pixel dimensions from a
 * single renderAsync. The rotation + resize are applied in the same
 * ImageManipulator chain, so only 1 native decode happens.
 *
 * For cascaded calls (resizing from a previously saved thumbnail), set
 * skipOrientationDetection=true to avoid the unnecessary EXIF check.
 */
async function resizeToWebP(
  inputUri: string,
  maxSize: number,
  skipOrientationDetection?: boolean,
): Promise<{ savedUri: string; mimeType: string }> {
  const ctx = ImageManipulator.manipulate(inputUri)

  let isPortrait: boolean
  if (skipOrientationDetection) {
    // Input is an already-oriented thumbnail — just check dimensions via
    // a lightweight getImageSize call (no pixel decode).
    try {
      const size = await getImageSize(inputUri)
      isPortrait = size.height > size.width
    } catch {
      isPortrait = false
    }
  } else {
    // First resize from the original source: detect EXIF orientation.
    // renderAsync decodes the full image — we use the same ctx for the
    // subsequent resize so this is the only decode.
    const rendered = await ctx.renderAsync()
    isPortrait = rendered.height > rendered.width

    try {
      const exifSize = await getImageSize(inputUri)
      const rawIsLandscape = rendered.width >= rendered.height
      const exifIsLandscape = exifSize.width >= exifSize.height
      if (rawIsLandscape !== exifIsLandscape) {
        ctx.rotate(90)
      }
      isPortrait = exifSize.height > exifSize.width
    } catch {
      // Fall back to raw dimensions if Image.getSize fails
    }
  }

  if (isPortrait) {
    ctx.resize({ height: maxSize })
  } else {
    ctx.resize({ width: maxSize })
  }
  const resized = await ctx.renderAsync()
  const saved = await resized.saveAsync({
    compress: 0.8,
    format: SaveFormat.WEBP,
  })
  return { savedUri: saved.uri, mimeType: 'image/webp' }
}

// Image MIMEs that ImageIO (iOS) and BitmapFactory (Android) can decode.
// Excluded: proprietary camera RAW (CR2/CR3/NEF/NRW/ARW/RAF/ORF/RW2/PEF),
// JPEG XL, PSD, SVG (vector), HEIC sequence (multi-frame), AVCI/AVCS, ICO
// (multi-resolution), TIFF.
const MOBILE_THUMBNAILABLE_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/bmp',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/avif',
  'image/dng',
  'image/x-adobe-dng',
  'image/x-apple-proraw',
] as const satisfies readonly MimeType[]

// Video MIMEs where AVAssetImageGenerator (iOS) and MediaMetadataRetriever
// (Android) can produce a frame. Excluded: MKV/WebM (Android-only),
// WMV/FLV/MPEG/OGV (neither), AVI (codec-dependent).
const MOBILE_THUMBNAILABLE_VIDEO_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/x-m4v',
  'video/3gpp',
  'video/3gpp2',
] as const satisfies readonly MimeType[]

const MOBILE_THUMBNAILABLE_TYPES: readonly string[] = [
  ...MOBILE_THUMBNAILABLE_IMAGE_TYPES,
  ...MOBILE_THUMBNAILABLE_VIDEO_TYPES,
]

async function tryOsThumb(
  localId: string | null | undefined,
  size: number,
): Promise<ThumbnailResult | null> {
  if (!localId) return null
  const r = await getOsThumbnail(localId, size)
  if (!r) return null
  return { savedUri: r.uri, mimeType: r.mimeType }
}

export function createMobileThumbnailAdapter(): ThumbnailAdapter {
  return {
    thumbnailableTypes: MOBILE_THUMBNAILABLE_TYPES,
    async generateImageThumbnail(
      sourcePath: string,
      targetSize: number,
      opts?: { localId?: string | null },
    ): Promise<ThumbnailResult> {
      const os = await tryOsThumb(opts?.localId, targetSize)
      if (os) return os
      return resizeToWebP(sourcePath, targetSize as ThumbSize)
    },

    async generateImageThumbnails(
      sourcePath: string,
      sizes: number[],
      opts?: { localId?: string | null },
    ): Promise<Map<number, ThumbnailResult>> {
      const sorted = [...sizes].sort((a, b) => b - a)
      const results = new Map<number, ThumbnailResult>()

      // First try every size via the OS path in parallel. Anything that
      // returns null falls through to the resize cascade below.
      const osResults = await Promise.all(
        sorted.map((size) => tryOsThumb(opts?.localId, size).then((r) => ({ size, r }))),
      )
      const missing: number[] = []
      for (const { size, r } of osResults) {
        if (r) results.set(size, r)
        else missing.push(size)
      }
      if (missing.length === 0) return results

      let inputUri = sourcePath
      let skipDetection = false
      for (const size of missing) {
        const result = await resizeToWebP(inputUri, size, skipDetection)
        results.set(size, result)
        // Subsequent smaller sizes resize from the larger result.
        // That file is already correctly oriented and much smaller,
        // so decoding it is essentially free.
        inputUri = result.savedUri
        skipDetection = true
      }

      return results
    },

    async generateVideoThumbnail(sourcePath: string, targetSize: number): Promise<ThumbnailResult> {
      const thumb = await VideoThumbnails.getThumbnailAsync(sourcePath, {
        time: 1000,
        quality: 0.8,
      })
      return resizeToWebP(thumb.uri, targetSize as ThumbSize)
    },
  }
}
