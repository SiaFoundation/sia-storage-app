export type ViewerKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'json'
  | 'markdown'
  | 'text'
  | 'unsupported'

// Image MIMEs the viewer can render. ImageViewer uses
// @likashefqet/react-native-image-zoom, an Animated wrapper over React Native's
// stock <Image>, so decoding falls back to the platform image stack: UIImage /
// ImageIO on iOS, BitmapFactory on Android. DNG variants are included — iOS
// handles them via Apple ProRAW / Adobe DNG, Android via BitmapFactory on API
// 24+. Excluded: proprietary camera RAW (CR2/CR3/NEF/NRW/ARW/RAF/ORF/RW2/PEF),
// JPEG XL (no decoder), PSD (no native decoder), HEIC sequence (multi-frame
// container, not a single still), AVCI/AVCS (niche AVC-image), TIFF (decoder
// support is unreliable across devices).
const IMAGE_VIEWABLE_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/heic',
  'image/heif',
  'image/avif',
  'image/dng',
  'image/x-adobe-dng',
  'image/x-apple-proraw',
  'image/svg+xml',
  'image/vnd.microsoft.icon',
])

// Video MIMEs that expo-video (AVPlayer iOS / ExoPlayer Android) can decode
// reliably on both platforms. Excluded: MKV/WebM (Android only — AVPlayer
// doesn't decode), WMV/FLV/OGV (neither), AVI (codec-dependent, often fails).
const VIDEO_PLAYABLE_TYPES: ReadonlySet<string> = new Set([
  'video/mp4',
  'video/quicktime',
  'video/x-m4v',
  'video/3gpp',
  'video/3gpp2',
])

// Audio MIMEs that the native audio player can decode on both platforms.
// Excluded: WMA (neither), AMR (Android only — and rarely encountered), MIDI
// (rendering quality varies wildly, often silent).
const AUDIO_PLAYABLE_TYPES: ReadonlySet<string> = new Set([
  'audio/mpeg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/wav',
  'audio/flac',
  'audio/ogg',
  'audio/opus',
  'audio/aiff',
  'audio/x-caf',
])

export function pickViewerForFile(
  type: string | null | undefined,
  name: string | null | undefined,
): ViewerKind {
  const lowerName = name?.toLowerCase() ?? ''

  if (type && IMAGE_VIEWABLE_TYPES.has(type)) return 'image'
  if (type && VIDEO_PLAYABLE_TYPES.has(type)) return 'video'
  if (type && AUDIO_PLAYABLE_TYPES.has(type)) return 'audio'

  if (type === 'application/pdf' || lowerName.endsWith('.pdf')) return 'pdf'

  if (type === 'application/json' || lowerName.endsWith('.json')) return 'json'

  if (
    type === 'text/markdown' ||
    type === 'text/x-markdown' ||
    lowerName.endsWith('.md') ||
    lowerName.endsWith('.markdown')
  ) {
    return 'markdown'
  }

  if (
    type === 'text/plain' ||
    type === 'text/csv' ||
    type === 'text/xml' ||
    type === 'application/xml' ||
    type === 'text/html' ||
    type === 'text/css' ||
    type === 'text/javascript' ||
    type === 'application/yaml' ||
    type === 'application/toml' ||
    lowerName.endsWith('.txt') ||
    lowerName.endsWith('.csv') ||
    lowerName.endsWith('.xml') ||
    lowerName.endsWith('.html') ||
    lowerName.endsWith('.htm') ||
    lowerName.endsWith('.css') ||
    lowerName.endsWith('.js')
  ) {
    return 'text'
  }

  return 'unsupported'
}
