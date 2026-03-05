import { getMimeTypeFromExtension, isMimeType } from './fileTypes'

const FTYP_BRANDS_HEIC = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
])
const FTYP_BRANDS_VIDEO = new Set(['isom', 'iso2', 'mp41', 'mp42', 'M4V '])
const FTYP_BRANDS_AUDIO = new Set(['M4A ', 'M4B '])

export const MAGIC_BYTES_LENGTH = 32

/**
 * Detect MIME type from file magic bytes.
 * Pure function — no I/O, works on any platform.
 */
export function detectMimeTypeFromBytes(bytes: Uint8Array): string | null {
  if (!bytes || bytes.length === 0) return null

  // JPEG: FF D8 FF
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return 'image/jpeg'

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return 'image/png'

  // GIF: 47 49 46 38
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  )
    return 'image/gif'

  // WebP: RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return 'image/webp'

  // BMP: 42 4D
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d)
    return 'image/bmp'

  // TIFF (little-endian): 49 49 2A 00
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x49 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x2a &&
    bytes[3] === 0x00
  )
    return 'image/tiff'

  // TIFF (big-endian): 4D 4D 00 2A
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x4d &&
    bytes[1] === 0x4d &&
    bytes[2] === 0x00 &&
    bytes[3] === 0x2a
  )
    return 'image/tiff'

  // ftyp box (HEIC/HEIF/AVIF/MP4/MOV/M4A)
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])
    if (FTYP_BRANDS_HEIC.has(brand)) return 'image/heic'
    if (brand === 'mif1') return 'image/heif'
    if (brand === 'avif') return 'image/avif'
    if (FTYP_BRANDS_VIDEO.has(brand)) return 'video/mp4'
    if (brand === 'qt  ' || brand === 'mov ') return 'video/quicktime'
    if (FTYP_BRANDS_AUDIO.has(brand)) return 'audio/mp4'
  }

  // WAV: RIFF....WAVE
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  )
    return 'audio/wav'

  // MP3: ID3 tag or MPEG frame sync
  if (bytes.length >= 3) {
    if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33)
      return 'audio/mpeg'
    if (
      bytes[0] === 0xff &&
      (bytes[1] === 0xfb || bytes[1] === 0xf3 || bytes[1] === 0xf2)
    )
      return 'audio/mpeg'
  }

  // PDF: %PDF
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  )
    return 'application/pdf'

  return null
}

/**
 * Unified MIME type detection with priority chain:
 * 1. providedType if recognized
 * 2. Extension from fileName
 * 3. Magic bytes
 * 4. Fallback: application/octet-stream
 *
 * Synchronous, pure, no I/O. Callers read bytes themselves.
 */
export function detectMimeType(opts: {
  providedType?: string | null
  fileName?: string | null
  bytes?: Uint8Array | null
}): string {
  if (opts.providedType && isMimeType(opts.providedType)) {
    return opts.providedType
  }

  if (opts.fileName) {
    const fromExt = getMimeTypeFromExtension(opts.fileName)
    if (fromExt) return fromExt
  }

  if (opts.bytes) {
    const fromBytes = detectMimeTypeFromBytes(opts.bytes)
    if (fromBytes) return fromBytes
  }

  return 'application/octet-stream'
}
