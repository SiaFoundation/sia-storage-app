import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readOrientation } from '../../src/imageOrientation'

// fixtures/orientation/<n>.heic and <n>.tiff are the same 32x16 image written
// by ImageIO with EXIF orientation n. ImageIO stores a HEIC's as irot and
// imir properties and a TIFF's as the Orientation tag.
const fixture = (name: string) => join(import.meta.dir, '../fixtures/orientation', name)

const dir = mkdtempSync(join(tmpdir(), 'sia-orientation-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('readOrientation', () => {
  it('reads the EXIF orientation from a TIFF', async () => {
    expect(await readOrientation(fixture('1.tiff'))).toEqual({ rotate: 0, flop: false })
    expect(await readOrientation(fixture('6.tiff'))).toEqual({ rotate: 90, flop: false })
    expect(await readOrientation(fixture('7.tiff'))).toEqual({ rotate: 270, flop: true })
  })

  it('reads the same turn from a HEIC as from a TIFF with the same orientation', async () => {
    for (let n = 1; n <= 8; n++) {
      expect(await readOrientation(fixture(`${n}.heic`))).toEqual(
        await readOrientation(fixture(`${n}.tiff`)),
      )
    }
  })

  it('leaves JPEG to Bun', async () => {
    const path = join(dir, 'a.jpg')
    writeFileSync(path, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]))
    expect(await readOrientation(path)).toBeNull()
  })

  it('returns null for a HEIC cut off inside its meta box', async () => {
    const path = join(dir, 'cut.heic')
    writeFileSync(path, readFileSync(fixture('6.heic')).subarray(0, 200))
    expect(await readOrientation(path)).toBeNull()
  })

  it('gives up on a HEIC whose meta box sits behind too many boxes', async () => {
    // The fixture's ftyp box is its first 36 bytes, with meta right after it.
    const heic = readFileSync(fixture('6.heic'))
    const padded = (count: number) =>
      Buffer.concat([
        heic.subarray(0, 36),
        ...Array.from({ length: count }, () => box('free', [])),
        heic.subarray(36),
      ])
    const near = join(dir, 'near.heic')
    const far = join(dir, 'far.heic')
    writeFileSync(near, padded(10))
    writeFileSync(far, padded(1000))
    expect(await readOrientation(near)).toEqual({ rotate: 90, flop: false })
    expect(await readOrientation(far)).toBeNull()
  })

  it('finds the primary item in the first of two ipma boxes', async () => {
    const u16 = (n: number) => [n >> 8, n & 0xff]
    const u32 = (n: number) => [0, 0, ...u16(n)]
    const meta = box('meta', [
      ...[0, 0, 0, 0],
      ...box('pitm', [0, 0, 0, 0, ...u16(1)]),
      ...box('iprp', [
        // irot 1 is a quarter turn anticlockwise.
        ...box('ipco', [...box('irot', [1])]),
        // Version 0: item 1, the primary, has property 1.
        ...box('ipma', [0, 0, 0, 0, ...u32(1), ...u16(1), 1, 0x81]),
        // Version 1: item 2 has no properties.
        ...box('ipma', [1, 0, 0, 0, ...u32(1), ...u32(2), 0]),
      ]),
    ])
    const path = join(dir, 'two-ipma.heic')
    writeFileSync(
      path,
      Buffer.concat([
        box('ftyp', [...Buffer.from('heic'), 0, 0, 0, 0, ...Buffer.from('mif1')]),
        meta,
      ]),
    )
    expect(await readOrientation(path)).toEqual({ rotate: 270, flop: false })
  })
})

/** An ISO BMFF box: a 32-bit size, the type, then the payload. */
function box(type: string, payload: number[]): Buffer {
  const size = 8 + payload.length
  return Buffer.from([
    size >>> 24,
    (size >> 16) & 0xff,
    (size >> 8) & 0xff,
    size & 0xff,
    ...Buffer.from(type),
    ...payload,
  ])
}
