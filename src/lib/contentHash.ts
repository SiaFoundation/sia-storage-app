import RNFS from 'react-native-fs'
import QuickCrypto from 'react-native-quick-crypto'
import { Skia, SkImage } from '@shopify/react-native-skia'
import { Buffer } from 'buffer'

export type HashResult =
  | `sha256|IMGv1-RGBA|${string}`
  | `sha256|BYTESv1|${string}`

/**
 * Calculate a content hash for a file.
 * - Images: Pixel-hash in canonical sRGB RGBA8 to ignore EXIF/metadata differences.
 * - Others (video, audio, documents): Raw byte SHA-256 for exact file identity.
 */
export async function calculateContentHash(
  uri: string
): Promise<HashResult | null> {
  if (!uri || uri === '') {
    return null
  }
  const img = await tryDecodeImage(uri)
  if (img) {
    const hex = await hashImagePixels(img)
    return `sha256|IMGv1-RGBA|${hex}`
  }
  const hex = await sha256File(uri)
  return `sha256|BYTESv1|${hex}`
}

/** Try to decode with Skia. If decode fails, return null. */
async function tryDecodeImage(uri: string): Promise<SkImage | null> {
  try {
    // Skia decode requires the full encoded image bytes.
    const b64 = await RNFS.readFile(uri, 'base64')
    const data = Skia.Data.fromBase64(b64)
    const img = Skia.Image.MakeImageFromEncoded(data)
    return img ?? null
  } catch {
    return null
  }
}

/**
 * Canonical pixel hash for images.
 * - Decoded to sRGB RGBA8 by Skia, normalizing EXIF orientation and color space.
 * - Prelude encodes a stable header: tag + width + height + pixel format.
 * - Hash is SHA-256 over prelude || raw RGBA pixel data.
 */
async function hashImagePixels(img: SkImage): Promise<string> {
  const width = img.width()
  const height = img.height()

  // Read pixel data. Skia returns Uint8Array (RGBA8) or Float32Array (rare HDR paths).
  const pixelData = img.readPixels()
  if (!pixelData) throw new Error('readPixels failed')

  // If Float32Array, reinterpret to bytes in native order.
  const pixels =
    pixelData instanceof Uint8Array
      ? pixelData
      : new Uint8Array(pixelData.buffer)

  // Build stable prelude: "IMG1" + width/height (u32 LE) + tag "RGBA".
  const prelude = new Uint8Array(4 + 4 + 4 + 4)
  prelude.set([0x49, 0x4d, 0x47, 0x31], 0) // "IMG1".
  new DataView(prelude.buffer).setUint32(4, width, true)
  new DataView(prelude.buffer).setUint32(8, height, true)
  prelude.set([0x52, 0x47, 0x42, 0x41], 12) // "RGBA".

  const h = QuickCrypto.createHash('sha256')
  const preludeBuf = Buffer.from(prelude)
  h.update(sliceBuffer(preludeBuf))

  const pixelsBuf = Buffer.from(pixels)
  h.update(sliceBuffer(pixelsBuf))
  return h.digest('hex')
}

/** Streamed SHA-256 for non-images and big files. */
async function sha256File(uri: string): Promise<string> {
  const h = QuickCrypto.createHash('sha256')
  const chunkSize = 1 * 1024 * 1024 // 1MB

  try {
    const stat = await RNFS.stat(uri)
    let pos = 0
    while (pos < stat.size) {
      const len = Math.min(chunkSize, stat.size - pos)
      const b64 = await RNFS.read(uri, len, pos, 'base64')
      const buf = Buffer.from(b64, 'base64')
      h.update(sliceBuffer(buf))
      pos += len
    }
  } catch {
    // Fallback for URIs where stat/ranged read is unsupported (some content:// cases):
    // Read entire file. Prefer avoiding this for very large files but ensures correctness.
    const b64 = await RNFS.readFile(uri, 'base64')
    const buf = Buffer.from(b64, 'base64')
    h.update(sliceBuffer(buf))
  }
  return h.digest('hex')
}

// Extract the exact ArrayBuffer slice to avoid extra capacity bytes.
function sliceBuffer(buf: Buffer<ArrayBuffer>): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}
