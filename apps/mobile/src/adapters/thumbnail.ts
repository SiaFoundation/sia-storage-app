import type { ThumbnailAdapter, ThumbnailResult } from '@siastorage/core/adapters'
import type { MimeType } from '@siastorage/core/lib/fileTypes'
import type { ThumbSize } from '@siastorage/core/types'
import { Platform } from 'react-native'
import { imageThumbnails, videoThumbnail, type ThumbnailFile } from 'thumbnailer'

const VIDEO_FRAME_TIME_MS = 1000

function toResult(file: ThumbnailFile): ThumbnailResult {
  return { savedUri: file.uri, mimeType: file.mimeType }
}

// Image MIMEs both ImageIO (iOS) and BitmapFactory (Android) decode. HEIC/HEIF
// need iOS 11+ / Android 9+ and AVIF needs iOS 16+ / Android 12+; older OS
// versions just fall back to the placeholder icon. Excluded everywhere:
// non-DNG camera RAW (CR2/CR3/NEF/NRW/ARW/RAF/ORF/RW2/PEF), JPEG XL, PSD, SVG,
// multi-frame HEIC, AVCI/AVCS, ICO, TIFF.
const SHARED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/bmp',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/avif',
] as const satisfies readonly MimeType[]

// DNG and Apple ProRAW decode through iOS ImageIO but not Android's
// BitmapFactory (no RAW support), so they're iOS-only candidates.
const IOS_ONLY_IMAGE_TYPES = [
  'image/dng',
  'image/x-adobe-dng',
  'image/x-apple-proraw',
] as const satisfies readonly MimeType[]

// Video MIMEs where AVAssetImageGenerator (iOS) and MediaMetadataRetriever
// (Android) can produce a frame. Excluded: MKV/WebM (Android-only),
// WMV/FLV/MPEG/OGV (neither), AVI (codec-dependent).
const VIDEO_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/x-m4v',
  'video/3gpp',
  'video/3gpp2',
] as const satisfies readonly MimeType[]

export function thumbnailableTypesFor(platform: 'ios' | 'android'): readonly string[] {
  const imageTypes =
    platform === 'ios' ? [...SHARED_IMAGE_TYPES, ...IOS_ONLY_IMAGE_TYPES] : SHARED_IMAGE_TYPES
  return [...imageTypes, ...VIDEO_TYPES]
}

// The native module reads EXIF/track orientation, applies it, and downsamples
// the decode at the source — so this adapter just forwards calls and maps the
// temp-file results into ThumbnailResults the scanner can adopt.
export function createMobileThumbnailAdapter(): ThumbnailAdapter {
  return {
    thumbnailableTypes: thumbnailableTypesFor(Platform.OS === 'ios' ? 'ios' : 'android'),

    async generateImageThumbnail(sourcePath: string, targetSize: number): Promise<ThumbnailResult> {
      const [file] = await imageThumbnails(sourcePath, [targetSize as ThumbSize])
      return toResult(file)
    },

    async generateImageThumbnails(
      sourcePath: string,
      sizes: number[],
    ): Promise<Map<number, ThumbnailResult>> {
      const files = await imageThumbnails(sourcePath, sizes)
      return new Map(sizes.map((size, i) => [size, toResult(files[i])]))
    },

    async generateVideoThumbnail(sourcePath: string, targetSize: number): Promise<ThumbnailResult> {
      const file = await videoThumbnail(sourcePath, targetSize as ThumbSize, VIDEO_FRAME_TIME_MS)
      return toResult(file)
    },
  }
}
