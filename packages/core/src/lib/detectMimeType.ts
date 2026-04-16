import { getMimeTypeFromExtension, isMimeType } from './fileTypes'

const FTYP_BRANDS_HEIC = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'])
const FTYP_BRANDS_VIDEO = new Set([
  'isom',
  'iso2',
  'mp41',
  'mp42',
  'M4V ',
  '3gp4',
  '3gp5',
  '3gp6',
  '3g2a',
  '3g2b',
  '3g2c',
])
const FTYP_BRANDS_AUDIO = new Set(['M4A ', 'M4B '])

export const MAGIC_BYTES_LENGTH = 32

/**
 * Detect MIME type from file magic bytes.
 * Pure function — no I/O, works on any platform.
 */
export function detectMimeTypeFromBytes(bytes: Uint8Array): string | null {
  if (!bytes || bytes.length === 0) return null

  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
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
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp'

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

  // RIFF container — disambiguated by the chunk-type field at offset 8:
  //   "WAVE" → audio/wav, "AVI " → video/x-msvideo
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46
  ) {
    if (bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45)
      return 'audio/wav'
    if (bytes[8] === 0x41 && bytes[9] === 0x56 && bytes[10] === 0x49 && bytes[11] === 0x20)
      return 'video/x-msvideo'
  }

  // AIFF: FORM....AIFF (or AIFC for compressed)
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x46 &&
    bytes[1] === 0x4f &&
    bytes[2] === 0x52 &&
    bytes[3] === 0x4d &&
    bytes[8] === 0x41 &&
    bytes[9] === 0x49 &&
    bytes[10] === 0x46 &&
    (bytes[11] === 0x46 || bytes[11] === 0x43)
  )
    return 'audio/aiff'

  // FLAC: 66 4C 61 43 ("fLaC")
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x66 &&
    bytes[1] === 0x4c &&
    bytes[2] === 0x61 &&
    bytes[3] === 0x43
  )
    return 'audio/flac'

  // OGG: 4F 67 67 53 ("OggS"). Container holds Vorbis/Opus/etc; report audio/ogg.
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x4f &&
    bytes[1] === 0x67 &&
    bytes[2] === 0x67 &&
    bytes[3] === 0x53
  )
    return 'audio/ogg'

  // Matroska / WebM: EBML header 1A 45 DF A3. Defaults to MKV; extension lookup
  // (which runs before magic bytes) resolves WebM via the .webm extension.
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  )
    return 'video/x-matroska'

  // 7z: 37 7A BC AF 27 1C
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x37 &&
    bytes[1] === 0x7a &&
    bytes[2] === 0xbc &&
    bytes[3] === 0xaf &&
    bytes[4] === 0x27 &&
    bytes[5] === 0x1c
  )
    return 'application/x-7z-compressed'

  // bzip2: 42 5A 68 ("BZh")
  if (bytes.length >= 3 && bytes[0] === 0x42 && bytes[1] === 0x5a && bytes[2] === 0x68)
    return 'application/x-bzip2'

  // xz: FD 37 7A 58 5A 00
  if (
    bytes.length >= 6 &&
    bytes[0] === 0xfd &&
    bytes[1] === 0x37 &&
    bytes[2] === 0x7a &&
    bytes[3] === 0x58 &&
    bytes[4] === 0x5a &&
    bytes[5] === 0x00
  )
    return 'application/x-xz'

  // RAR: "Rar!\x1A\x07\x00" (v1.5+) or "Rar!\x1A\x07\x01\x00" (v5)
  if (
    bytes.length >= 7 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x61 &&
    bytes[2] === 0x72 &&
    bytes[3] === 0x21 &&
    bytes[4] === 0x1a &&
    bytes[5] === 0x07 &&
    (bytes[6] === 0x00 || bytes[6] === 0x01)
  )
    return 'application/vnd.rar'

  // ZIP and ZIP-based formats (docx/xlsx/pptx/epub/apk). Three valid prefixes:
  //   50 4B 03 04 — local file header (most common)
  //   50 4B 05 06 — end-of-central-directory (empty archive)
  //   50 4B 07 08 — data descriptor (spanned archive)
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const b2 = bytes[2]
    const b3 = bytes[3]
    if (
      (b2 === 0x03 && b3 === 0x04) ||
      (b2 === 0x05 && b3 === 0x06) ||
      (b2 === 0x07 && b3 === 0x08)
    ) {
      return 'application/zip'
    }
  }

  // gzip: 1F 8B
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return 'application/gzip'

  // MP3: ID3 tag, or MPEG audio frame sync where the layer bits aren't 00
  // (reserved). The reserved-layer check rules out AAC ADTS, which shares
  // the 11-bit sync prefix but always carries layer=00.
  if (bytes.length >= 3) {
    if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return 'audio/mpeg'
    if (
      bytes[0] === 0xff &&
      (bytes[1] & 0xe0) === 0xe0 && // 11-bit sync
      (bytes[1] & 0x18) !== 0x08 && // version != reserved
      (bytes[1] & 0x06) !== 0x00 // layer != reserved
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
