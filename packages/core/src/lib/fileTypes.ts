export const MimeTypes = [
  // video
  'video/quicktime',
  'video/mp4',
  'video/x-m4v',
  // image
  'image/dng',
  'image/x-adobe-dng',
  'image/x-apple-proraw',
  'image/heic',
  'image/heif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/tiff',
  // audio
  'audio/mpeg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/wav',
  // text/docs
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'application/json',
  'application/pdf',
  // other
  'application/octet-stream',
] as const

export type MimeType = (typeof MimeTypes)[number]

export type Ext =
  // video
  | '.mov'
  | '.mp4'
  | '.m4v'
  // image
  | '.dng'
  | '.heic'
  | '.heif'
  | '.jpg'
  | '.png'
  | '.webp'
  | '.gif'
  | '.tiff'
  // audio
  | '.mp3'
  | '.m4a'
  | '.aac'
  | '.wav'
  // text/docs
  | '.txt'
  | '.md'
  | '.json'
  | '.pdf'
  // other
  | '.bin'

const extensionToMimeMap: Record<string, MimeType> = {
  // video
  mov: 'video/quicktime',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  // image
  dng: 'image/dng',
  heic: 'image/heic',
  heif: 'image/heif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  // audio
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  // text/docs
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  json: 'application/json',
  pdf: 'application/pdf',
}

export function getMimeTypeFromExtension(
  path: string | undefined,
): MimeType | null {
  if (!path) return null
  const ext = path.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase()
  if (!ext) return null
  return extensionToMimeMap[ext] ?? null
}

export function extFromMime(mime?: string | null): Ext {
  // video
  if (mime === 'video/quicktime') return '.mov'
  if (mime === 'video/mp4') return '.mp4'
  if (mime === 'video/x-m4v') return '.m4v'
  // image
  if (
    mime === 'image/dng' ||
    mime === 'image/x-adobe-dng' ||
    mime === 'image/x-apple-proraw'
  )
    return '.dng'
  if (mime === 'image/heic') return '.heic'
  if (mime === 'image/heif') return '.heif'
  if (mime === 'image/jpeg') return '.jpg'
  if (mime === 'image/png') return '.png'
  if (mime === 'image/webp') return '.webp'
  if (mime === 'image/gif') return '.gif'
  if (mime === 'image/tiff') return '.tiff'
  // audio
  if (mime === 'audio/mpeg') return '.mp3'
  if (mime === 'audio/mp4' || mime === 'audio/x-m4a') return '.m4a'
  if (mime === 'audio/aac') return '.aac'
  if (mime === 'audio/wav') return '.wav'
  // text/docs
  if (mime === 'text/plain') return '.txt'
  if (mime === 'text/markdown' || mime === 'text/x-markdown') return '.md'
  if (mime === 'application/json') return '.json'
  if (mime === 'application/pdf') return '.pdf'
  // other
  if (mime === 'application/octet-stream') return '.bin'
  return '.bin'
}

export function isMimeType(type?: string): type is MimeType {
  return MimeTypes.includes(type as MimeType)
}
