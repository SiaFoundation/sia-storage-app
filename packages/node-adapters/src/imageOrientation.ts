/**
 * Reads how an image in the HEIF container (HEIC, and AVIF, which shares it)
 * or a TIFF has to be turned to display upright. Bun.Image applies the EXIF
 * Orientation tag for JPEG only. It decodes these formats through the OS
 * codecs and hands back the stored pixels, so a portrait iPhone HEIC comes
 * out on its side. A thumbnail is synced to other devices as plain WebP
 * pixels with no orientation of its own, so every device shows whatever
 * the generator got wrong.
 *
 * HEIF keeps the turn in `irot` and `imir` item properties, applied in the
 * order the primary item lists them. TIFF keeps it in the Orientation tag of
 * the first IFD. Both are read with ranged file reads, so a large file is
 * not loaded to find a few bytes.
 */

/** Rotate clockwise first, then mirror left to right, the order Bun.Image applies them. */
export type Orientation = { rotate: 0 | 90 | 180 | 270; flop: boolean }

type Matrix = readonly [number, number, number, number]

// 2x2 matrices on (x, y) with y pointing down.
const IDENTITY: Matrix = [1, 0, 0, 1]
const CLOCKWISE: Matrix = [0, -1, 1, 0]
const FLOP: Matrix = [-1, 0, 0, 1]
const FLIP: Matrix = [1, 0, 0, -1]

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
  ]
}

function toOrientation(m: Matrix): Orientation {
  let rotation = IDENTITY
  for (const rotate of [0, 90, 180, 270] as const) {
    for (const flop of [false, true]) {
      const candidate = flop ? multiply(FLOP, rotation) : rotation
      if (candidate.every((v, i) => v === m[i])) return { rotate, flop }
    }
    rotation = multiply(CLOCKWISE, rotation)
  }
  throw new Error('not a rotation or mirror')
}

// EXIF Orientation values 1 to 8, as defined by TIFF 6.0.
const EXIF_ORIENTATIONS: Record<number, Orientation> = {
  1: { rotate: 0, flop: false },
  2: { rotate: 0, flop: true },
  3: { rotate: 180, flop: false },
  4: { rotate: 180, flop: true },
  5: { rotate: 90, flop: true },
  6: { rotate: 90, flop: false },
  7: { rotate: 270, flop: true },
  8: { rotate: 270, flop: false },
}

// An iPhone HEIC's meta box is tens of kilobytes. This bounds the read for a
// file whose box sizes are corrupt.
const MAX_META_BYTES = 16 * 1024 * 1024

// Each top-level box costs a file read, so a file of tiny padding boxes ahead
// of its meta box would otherwise take a read per 8 bytes. ImageIO, which
// writes iPhone photos, puts meta second, so one this deep is treated as missing.
const MAX_TOP_LEVEL_BOXES = 64

async function readRange(path: string, start: number, length: number): Promise<DataView> {
  const buf = await Bun.file(path)
    .slice(start, start + length)
    .arrayBuffer()
  return new DataView(buf)
}

function fourcc(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  )
}

type Box = { type: string; start: number; headerSize: number; size: number }

/** Child boxes of `view` between `start` and `end`. Stops at the first malformed size. */
function* childBoxes(view: DataView, start: number, end: number): Generator<Box> {
  let p = start
  while (p + 8 <= end) {
    let size = view.getUint32(p)
    let headerSize = 8
    if (size === 1) {
      if (p + 16 > end) return
      size = Number(view.getBigUint64(p + 8))
      headerSize = 16
    } else if (size === 0) {
      size = end - p
    }
    if (size < headerSize || p + size > end) return
    yield { type: fourcc(view, p + 4), start: p, headerSize, size }
    p += size
  }
}

async function findMetaBox(path: string, fileSize: number): Promise<DataView | null> {
  let p = 0
  for (let boxes = 0; boxes < MAX_TOP_LEVEL_BOXES && p + 8 <= fileSize; boxes++) {
    const head = await readRange(path, p, 16)
    if (head.byteLength < 8) return null
    let size = head.getUint32(0)
    if (size === 1) {
      if (head.byteLength < 16) return null
      size = Number(head.getBigUint64(8))
    } else if (size === 0) {
      size = fileSize - p
    }
    if (size < 8) return null
    if (fourcc(head, 4) === 'meta') {
      if (size > MAX_META_BYTES) return null
      return readRange(path, p, size)
    }
    p += size
  }
  return null
}

function heifOrientation(meta: DataView): Orientation | null {
  // meta is a full box, so its children start after the 4-byte version and flags.
  const metaBox = childBoxes(meta, 0, meta.byteLength).next().value
  if (!metaBox) return null
  const childrenStart = metaBox.start + metaBox.headerSize + 4

  let primaryId: number | null = null
  const properties: { type: string; payload: number }[] = []
  // HEIF allows one ipma box per version and flags pair, and an item's
  // associations sit in only one of them, so each is searched for the primary.
  const ipmaBodies: number[] = []

  for (const box of childBoxes(meta, childrenStart, metaBox.start + metaBox.size)) {
    const body = box.start + box.headerSize
    if (box.type === 'pitm') {
      primaryId = meta.getUint8(body) === 0 ? meta.getUint16(body + 4) : meta.getUint32(body + 4)
    }
    if (box.type !== 'iprp') continue
    for (const inner of childBoxes(meta, body, box.start + box.size)) {
      const innerBody = inner.start + inner.headerSize
      if (inner.type === 'ipco') {
        for (const prop of childBoxes(meta, innerBody, inner.start + inner.size)) {
          const payload = prop.start + prop.headerSize
          properties.push({
            type: prop.type,
            payload: payload < prop.start + prop.size ? meta.getUint8(payload) : 0,
          })
        }
      }
      if (inner.type === 'ipma') ipmaBodies.push(innerBody)
    }
  }
  if (primaryId === null) return null
  let associations: number[] | null = null
  for (const body of ipmaBodies) {
    associations = readAssociations(meta, body, primaryId)
    if (associations !== null) break
  }
  if (associations === null) return null

  let m = IDENTITY
  for (const index of associations) {
    const prop = properties[index - 1]
    if (prop?.type === 'irot') {
      // irot turns anticlockwise, in steps of 90 degrees.
      const clockwiseTurns = (4 - (prop.payload & 3)) % 4
      for (let i = 0; i < clockwiseTurns; i++) m = multiply(CLOCKWISE, m)
    } else if (prop?.type === 'imir') {
      // axis 0 swaps top and bottom and axis 1 swaps left and right, the way
      // ImageIO writes and reads them and libheif reads them.
      m = multiply(prop.payload & 1 ? FLOP : FLIP, m)
    }
  }
  return toOrientation(m)
}

/** The 1-based ipco indexes associated with `itemId`, in the order listed. */
function readAssociations(view: DataView, body: number, itemId: number): number[] | null {
  const version = view.getUint8(body)
  const wideIndexes = (view.getUint32(body) & 1) === 1
  const count = view.getUint32(body + 4)
  let p = body + 8
  for (let i = 0; i < count; i++) {
    const id = version < 1 ? view.getUint16(p) : view.getUint32(p)
    p += version < 1 ? 2 : 4
    const n = view.getUint8(p)
    p += 1
    const indexes: number[] = []
    for (let j = 0; j < n; j++) {
      if (wideIndexes) {
        indexes.push(view.getUint16(p) & 0x7fff)
        p += 2
      } else {
        indexes.push(view.getUint8(p) & 0x7f)
        p += 1
      }
    }
    if (id === itemId) return indexes
  }
  return null
}

async function tiffOrientation(path: string, head: DataView): Promise<Orientation | null> {
  const little = head.getUint8(0) === 0x49
  const ifdOffset = head.getUint32(4, little)
  const countView = await readRange(path, ifdOffset, 2)
  if (countView.byteLength < 2) return null
  const count = countView.getUint16(0, little)
  const entries = await readRange(path, ifdOffset + 2, count * 12)
  if (entries.byteLength < count * 12) return null
  for (let p = 0; p < entries.byteLength; p += 12) {
    if (entries.getUint16(p, little) !== 0x0112) continue
    return EXIF_ORIENTATIONS[entries.getUint16(p + 8, little)] ?? null
  }
  return { rotate: 0, flop: false }
}

/**
 * The turn that displays the image at `path` upright, or null for a format
 * this does not read, which includes JPEG, or for a file it cannot parse.
 */
export async function readOrientation(path: string): Promise<Orientation | null> {
  const file = Bun.file(path)
  const head = await readRange(path, 0, 16)
  if (head.byteLength < 8) return null
  try {
    const tag = fourcc(head, 0)
    if (tag === 'II*\0' || tag === 'MM\0*') return await tiffOrientation(path, head)
    if (fourcc(head, 4) === 'ftyp') {
      const meta = await findMetaBox(path, file.size)
      return meta ? heifOrientation(meta) : null
    }
  } catch (e) {
    // A box whose fields run past the bytes the file holds for it.
    if (e instanceof RangeError) return null
    throw e
  }
  return null
}
