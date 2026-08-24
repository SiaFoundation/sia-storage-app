import {
  getMimeTypeFromExtension,
  isIdentifiedMimeType,
  isMimeType,
  lookupTable,
} from './fileTypes'

const FTYP_BRANDS_HEIC = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'])
const FTYP_BRANDS_VIDEO = new Set([
  'isom',
  'iso2',
  'mp41',
  'mp42',
  'avc1',
  'mmp4',
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

type MagicPrefix = { mime: string; sig: readonly number[] }

/**
 * Formats identified by a fixed byte sequence at offset 0, first match wins.
 * Anything needing more than a prefix compare (a container brand, an
 * alternative byte, a bitmask) stays in detectMimeTypeFromBytes.
 *
 * The ftyp check reads offsets 4 to 11 and ignores the box length in front of
 * them, so a buffer can match it and a prefix at once. These image prefixes
 * win that tie and the prefixes in MAGIC_PREFIXES lose it, the same answer
 * older app versions give for the same bytes, so two devices on different
 * versions agree on a file's type.
 */
const IMAGE_PREFIXES: ReadonlyArray<MagicPrefix> = [
  { mime: 'image/jpeg', sig: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', sig: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/gif', sig: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/bmp', sig: [0x42, 0x4d] },
  // TIFF, little-endian then big-endian.
  { mime: 'image/tiff', sig: [0x49, 0x49, 0x2a, 0x00] },
  { mime: 'image/tiff', sig: [0x4d, 0x4d, 0x00, 0x2a] },
]

const MAGIC_PREFIXES: ReadonlyArray<MagicPrefix> = [
  { mime: 'audio/flac', sig: [0x66, 0x4c, 0x61, 0x43] },
  // "OggS". The container holds Vorbis/Opus/etc; report the container.
  { mime: 'audio/ogg', sig: [0x4f, 0x67, 0x67, 0x53] },
  // EBML header. Defaults to MKV; the container refinement resolves WebM via
  // the .webm extension.
  { mime: 'video/x-matroska', sig: [0x1a, 0x45, 0xdf, 0xa3] },
  // An ID3 tag; a bare MPEG frame sync is matched separately.
  { mime: 'audio/mpeg', sig: [0x49, 0x44, 0x33] },
  { mime: 'application/x-7z-compressed', sig: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
  { mime: 'application/x-bzip2', sig: [0x42, 0x5a, 0x68] },
  { mime: 'application/x-xz', sig: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00] },
  { mime: 'application/gzip', sig: [0x1f, 0x8b] },
  // "Rar!\x1A\x07" followed by 00 for v1.5+ or 01 for v5.
  { mime: 'application/vnd.rar', sig: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00] },
  { mime: 'application/vnd.rar', sig: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01] },
  // ZIP and every ZIP-based format (docx/xlsx/pptx/epub/apk), as a local file
  // header, an end-of-central-directory for an empty archive, or a data
  // descriptor for a spanned one.
  { mime: 'application/zip', sig: [0x50, 0x4b, 0x03, 0x04] },
  { mime: 'application/zip', sig: [0x50, 0x4b, 0x05, 0x06] },
  { mime: 'application/zip', sig: [0x50, 0x4b, 0x07, 0x08] },
  { mime: 'application/pdf', sig: [0x25, 0x50, 0x44, 0x46] },
]

function hasPrefix(bytes: Uint8Array, sig: readonly number[]): boolean {
  if (bytes.length < sig.length) return false
  return sig.every((b, i) => bytes[i] === b)
}

/** The 4-byte ASCII field at `offset`: a RIFF chunk type, an ftyp brand. */
function tag4(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
}

/**
 * The major brand sits at offset 8 of an ftyp box and names the format inside
 * the ISO-BMFF container. An unrecognized brand yields null so detection falls
 * through to the checks after the ftyp block.
 */
function mimeFromFtypBrand(brand: string): string | null {
  // Canon raw: an ftyp container whose brand matches none of the sets below.
  if (brand === 'crx ') return 'image/x-canon-cr3'
  if (FTYP_BRANDS_HEIC.has(brand)) return 'image/heic'
  if (brand === 'mif1' || brand === 'msf1') return 'image/heif'
  if (brand === 'avif') return 'image/avif'
  if (FTYP_BRANDS_VIDEO.has(brand)) return 'video/mp4'
  if (brand.startsWith('qt') || brand === 'mov ') return 'video/quicktime'
  if (FTYP_BRANDS_AUDIO.has(brand)) return 'audio/mp4'
  return null
}

/**
 * Detect MIME type from file magic bytes.
 * Pure function — no I/O, works on any platform.
 */
export function detectMimeTypeFromBytes(bytes: Uint8Array): string | null {
  if (!bytes || bytes.length === 0) return null

  for (const { mime, sig } of IMAGE_PREFIXES) {
    if (hasPrefix(bytes, sig)) return mime
  }

  if (bytes.length >= 12) {
    const container = tag4(bytes, 0)

    if (container === 'RIFF') {
      const chunk = tag4(bytes, 8)
      if (chunk === 'WEBP') return 'image/webp'
      if (chunk === 'WAVE') return 'audio/wav'
      if (chunk === 'AVI ') return 'video/x-msvideo'
    }

    // AIFC is the compressed variant of AIFF.
    if (container === 'FORM') {
      const chunk = tag4(bytes, 8)
      if (chunk === 'AIFF' || chunk === 'AIFC') return 'audio/aiff'
    }

    if (tag4(bytes, 4) === 'ftyp') {
      const fromBrand = mimeFromFtypBrand(tag4(bytes, 8))
      if (fromBrand) return fromBrand
    }
  }

  for (const { mime, sig } of MAGIC_PREFIXES) {
    if (hasPrefix(bytes, sig)) return mime
  }

  // An MPEG audio frame sync whose layer bits aren't 00 (reserved). The
  // reserved-layer check rules out AAC ADTS, which shares the 11-bit sync
  // prefix but always carries layer=00.
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    (bytes[1] & 0xe0) === 0xe0 &&
    (bytes[1] & 0x18) !== 0x08 &&
    (bytes[1] & 0x06) !== 0x00
  )
    return 'audio/mpeg'

  return null
}

/**
 * A container's bytes cannot name the format inside it: a docx, xlsx, pptx,
 * epub, or apk all read as zip, webm reads as matroska, and DNG and the camera
 * raw formats built on TIFF (CR2, NEF, NRW, ARW, PEF) read as TIFF. When the
 * byte answer is a container, metadata may refine it, but only to a member of
 * that container's family; unrelated metadata leaves the container answer
 * standing (`.txt` next to zip bytes stays zip).
 */
const CONTAINER_REFINEMENTS = lookupTable<ReadonlySet<string>>({
  'application/zip': new Set([
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/epub+zip',
    'application/vnd.android.package-archive',
  ]),
  'video/x-matroska': new Set(['video/webm']),
  'image/tiff': new Set([
    'image/dng',
    'image/x-adobe-dng',
    'image/x-apple-proraw',
    'image/x-canon-cr2',
    'image/x-nikon-nef',
    'image/x-nikon-nrw',
    'image/x-sony-arw',
    'image/x-pentax-pef',
  ]),
})

/** Whether `type` names a format inside the container that `fromBytes` names. */
export function refinesContainer(fromBytes: string, type: string): boolean {
  return CONTAINER_REFINEMENTS[fromBytes]?.has(type) ?? false
}

function refineContainer(fromBytes: string, candidate: string | null): string {
  return candidate && refinesContainer(fromBytes, candidate) ? candidate : fromBytes
}

/**
 * Unified MIME type detection with priority chain:
 * 1. Magic bytes (ground truth — wins over a misleading extension), with
 *    container answers refined by metadata within the container's family.
 * 2. Extension from fileName
 * 3. providedType if recognized
 * 4. Fallback: application/octet-stream
 *
 * Synchronous, pure, no I/O. Callers read bytes themselves.
 */
export function detectMimeType(opts: {
  providedType?: string | null
  fileName?: string | null
  bytes?: Uint8Array | null
}): string {
  const fromExt = opts.fileName ? getMimeTypeFromExtension(opts.fileName) : null
  const provided = opts.providedType && isMimeType(opts.providedType) ? opts.providedType : null

  if (opts.bytes && opts.bytes.length > 0) {
    const fromBytes = detectMimeTypeFromBytes(opts.bytes)
    if (fromBytes) return refineContainer(fromBytes, fromExt ?? provided)
  }

  return fromExt ?? provided ?? 'application/octet-stream'
}

/**
 * The one classification call for an import row at finalize. `headerBytes`
 * and `mediaMime` come from the copy's single read; `stagedType` is the
 * metadata-derived type recorded at staging. A `media` row takes the
 * OS-reported type of the copied resource, but only when it identifies
 * something; everything else goes through the content-first chain.
 */
export function classifyImportType(opts: {
  stagedType: string
  name?: string | null
  sourceKind?: string | null
  headerBytes?: Uint8Array | null
  mediaMime?: string | null
}): string {
  if (opts.sourceKind === 'media' && isIdentifiedMimeType(opts.mediaMime)) {
    return opts.mediaMime
  }
  return detectMimeType({
    bytes: opts.headerBytes,
    fileName: opts.name,
    providedType: opts.stagedType,
  })
}
