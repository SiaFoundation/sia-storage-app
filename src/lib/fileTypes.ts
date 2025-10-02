import * as ImagePicker from 'react-native-image-picker'

export type Mime =
  | 'video/quicktime'
  | 'video/mp4'
  | 'video/x-m4v'
  | 'image/heic'
  | 'image/heif'
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'application/octet-stream'
  | 'application/pdf'

export function mimeFromAssetUri(a: ImagePicker.Asset): Mime {
  const name = a.fileName ?? ''
  const ext = name.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase()
  if (!ext) return 'application/octet-stream'
  const map: Record<string, Mime> = {
    mov: 'video/quicktime',
    mp4: 'video/mp4',
    m4v: 'video/x-m4v',
    heic: 'image/heic',
    heif: 'image/heif',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    pdf: 'application/pdf',
  }
  return map[ext] ?? 'application/octet-stream'
}

export type Ext =
  | '.mov'
  | '.mp4'
  | '.m4v'
  | '.heic'
  | '.heif'
  | '.jpg'
  | '.png'
  | '.webp'
  | '.pdf'
  | '.bin'
  | '.tmp'

export function extFromMime(mime?: string | null): Ext {
  if (mime === 'video/quicktime') return '.mov'
  if (mime === 'video/mp4') return '.mp4'
  if (mime === 'video/x-m4v') return '.m4v'
  if (mime === 'image/heic') return '.heic'
  if (mime === 'image/heif') return '.heif'
  if (mime === 'image/jpeg') return '.jpg'
  if (mime === 'image/png') return '.png'
  if (mime === 'image/webp') return '.webp'
  if (mime === 'application/pdf') return '.pdf'
  if (mime === 'application/octet-stream') return '.bin'
  return '.bin'
}
