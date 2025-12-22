import { type MimeType } from './fileTypes'
import { logger } from './logger'
import { readFileBytes } from './readFileBytes'

export const MAGIC_BYTES_LENGTH = 32

/**
 * Sniff file type from magic numbers.
 * Reads first 32 bytes from a file URI and checks against known signatures.
 */
export async function detectMimeType(
  uri: string | undefined
): Promise<MimeType | null> {
  if (!uri) return null

  try {
    const bytes = await readFileBytes(uri, MAGIC_BYTES_LENGTH)
    if (!bytes || bytes.length === 0) {
      return null
    }
    return detectMimeTypeFromBytes(bytes)
  } catch (e) {
    logger.error('detectMimeType', 'error:', e)
    return null
  }
}

/**
 * Sniff file type from magic numbers directly from bytes.
 */
export function detectMimeTypeFromBytes(bytes: Uint8Array): MimeType | null {
  if (!bytes || bytes.length === 0) {
    return null
  }

  // Check magic numbers for supported types.

  // JPEG: FF D8 FF
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'image/jpeg'
  }

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
  ) {
    return 'image/png'
  }

  // GIF: 47 49 46 38 (GIF8)
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return 'image/gif'
  }

  // WEBP: RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return 'image/webp'
  }

  // HEIC/HEIF: Check for ftyp with heic/heix/hevc/hevx/mif1
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])
    if (
      brand === 'heic' ||
      brand === 'heix' ||
      brand === 'hevc' ||
      brand === 'hevx' ||
      brand === 'mif1'
    ) {
      return 'image/heic'
    }
  }

  // MP4/MOV: Check for ftyp box
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])
    if (
      brand === 'isom' ||
      brand === 'mp41' ||
      brand === 'mp42' ||
      brand.startsWith('M4V')
    ) {
      return 'video/mp4'
    }
    if (brand === 'qt  ' || brand === 'mov ') {
      return 'video/quicktime'
    }
  }

  // MP3: ID3 tag (49 44 33) or MPEG frame sync (FF FB or FF F3 or FF F2)
  if (bytes.length >= 3) {
    if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
      return 'audio/mpeg'
    }
    if (
      bytes[0] === 0xff &&
      (bytes[1] === 0xfb || bytes[1] === 0xf3 || bytes[1] === 0xf2)
    ) {
      return 'audio/mpeg'
    }
  }

  // M4A: Same as MP4 but with M4A brand
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])
    if (brand === 'M4A ' || brand === 'M4B ') {
      return 'audio/mp4'
    }
  }

  // WAV: RIFF....WAVE
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x41 && // A
    bytes[10] === 0x56 && // V
    bytes[11] === 0x45 // E
  ) {
    return 'audio/wav'
  }

  // PDF: %PDF
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 // F
  ) {
    return 'application/pdf'
  }

  return null
}
