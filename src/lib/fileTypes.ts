import * as ImagePicker from 'react-native-image-picker'

export type Mime =
  // video
  | 'video/quicktime'
  | 'video/mp4'
  | 'video/x-m4v'
  // image
  | 'image/heic'
  | 'image/heif'
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/gif'
  // audio
  | 'audio/mpeg'
  | 'audio/mp4'
  | 'audio/x-m4a'
  | 'audio/aac'
  | 'audio/wav'
  // text/docs
  | 'text/plain'
  | 'text/markdown'
  | 'text/x-markdown'
  | 'application/json'
  | 'application/pdf'
  // other
  | 'application/octet-stream'

export function mimeFromAssetUri(a: ImagePicker.Asset): Mime {
  const name = a.fileName ?? ''
  return mimeFromFileName(name)
}

export function mimeFromFileName(name: string): Mime {
  const ext = name.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase()
  if (!ext) return 'application/octet-stream'
  const map: Record<string, Mime> = {
    // video
    mov: 'video/quicktime',
    mp4: 'video/mp4',
    m4v: 'video/x-m4v',
    // image
    heic: 'image/heic',
    heif: 'image/heif',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
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
  return map[ext] ?? 'application/octet-stream'
}

/**
 * Canonical file extensions used when saving.
 * Order: video → image → audio → text/docs → other
 */
export type Ext =
  // video
  | '.mov'
  | '.mp4'
  | '.m4v'
  // image
  | '.heic'
  | '.heif'
  | '.jpg'
  | '.png'
  | '.webp'
  | '.gif'
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
  | '.tmp'

export function extFromMime(mime?: string | null): Ext {
  // video
  if (mime === 'video/quicktime') return '.mov'
  if (mime === 'video/mp4') return '.mp4'
  if (mime === 'video/x-m4v') return '.m4v'
  // image
  if (mime === 'image/heic') return '.heic'
  if (mime === 'image/heif') return '.heif'
  if (mime === 'image/jpeg') return '.jpg'
  if (mime === 'image/png') return '.png'
  if (mime === 'image/webp') return '.webp'
  if (mime === 'image/gif') return '.gif'
  // audio
  if (mime === 'audio/mpeg') return '.mp3'
  if (mime === 'audio/mp4' || mime === 'audio/x-m4a') return '.m4a'
  if (mime === 'audio/aac') return '.aac'
  if (mime === 'audio/wav') return '.wav'
  // text/docs
  if (mime === 'text/plain') return '.txt'
  if (mime === 'text/markdown' || mime === 'text/x-markdown') return '.md' // normalize alias to .md
  if (mime === 'application/json') return '.json'
  if (mime === 'application/pdf') return '.pdf'
  // other
  if (mime === 'application/octet-stream') return '.bin'
  return '.bin'
}
