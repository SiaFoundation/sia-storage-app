/*
 * Draws the Windows icons into assets/icons: `bun run icons:windows`.
 *
 * The Mac icons put the logo on a rounded plate, the way macOS draws every app
 * icon. Windows draws app icons bare, so these are the logo's three squares on
 * transparent, drawn on whole pixels at each size so a 16 px icon stays sharp
 * rather than being a blurred downscale. Dev, test and the shipping app use the
 * logo's own colours. Beta uses the camo greens of the Mac beta icon, lightened
 * so they read on a dark taskbar as well as a light one, so a beta installed
 * beside the shipping app can be told apart.
 *
 * Windows picks an icon's small sizes for the title bar and its large sizes for
 * the taskbar, so the window's icon is two drawings in one file: the logo at
 * half the width at 16 to 24 px, the proportions of sia.tech's icon, and at
 * three quarters from 32 px up, which matches the size of the other apps'
 * taskbar icons. The tray takes a small size too, so it gets its own file at
 * three quarters throughout.
 */

import { deflateSync } from 'node:zlib'
import { join } from 'node:path'

type Rgb = [number, number, number]

/** Top left, top right and bottom right square, per build. */
export const PALETTES: Record<'standard' | 'beta', [Rgb, Rgb, Rgb]> = {
  standard: [
    [0xe5, 0x0a, 0xae],
    [0xc3, 0xe5, 0x00],
    [0x36, 0xd9, 0x55],
  ],
  beta: [
    [0x69, 0x8b, 0x23],
    [0x82, 0xab, 0x2b],
    [0x51, 0x6a, 0x1b],
  ],
}

const SMALL = [16, 20, 24]
const LARGE = [32, 40, 48, 64, 96, 256]

/**
 * The logo at `size` px, as RGBA rows: a 2x2 grid with the bottom left square
 * left empty, `fraction` of the icon's width, centred.
 */
export function drawLogo(size: number, fraction: number, colors: [Rgb, Rgb, Rgb]): Uint8Array {
  const cell = Math.round((size * fraction) / 2)
  const offset = Math.floor((size - 2 * cell) / 2)
  const pixels = new Uint8Array(size * size * 4)
  const squares: [number, number, Rgb][] = [
    [0, 0, colors[0]],
    [1, 0, colors[1]],
    [1, 1, colors[2]],
  ]
  for (const [column, row, [r, g, b]] of squares) {
    for (let y = offset + row * cell; y < offset + (row + 1) * cell; y++) {
      for (let x = offset + column * cell; x < offset + (column + 1) * cell; x++) {
        pixels.set([r, g, b, 255], (y * size + x) * 4)
      }
    }
  }
  return pixels
}

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(Bun.hash.crc32(body), body.length + 4)
  return out
}

/** A square RGBA image as a PNG. */
export function encodePng(size: number, pixels: Uint8Array): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.set([8, 6, 0, 0, 0], 8)
  // Each row starts with its filter type, 0 for none.
  const rows = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    rows.set(pixels.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', new Uint8Array()),
  ])
}

/**
 * An .ico holding each image as a PNG, which Windows reads since Vista. The
 * directory stores a width of 256 as 0, since the field is one byte.
 */
export function encodeIco(images: { size: number; png: Buffer }[]): Buffer {
  const directory = Buffer.alloc(6 + 16 * images.length)
  directory.writeUInt16LE(1, 2)
  directory.writeUInt16LE(images.length, 4)
  let offset = directory.length
  images.forEach(({ size, png }, i) => {
    const entry = 6 + 16 * i
    directory.writeUInt8(size % 256, entry)
    directory.writeUInt8(size % 256, entry + 1)
    directory.writeUInt16LE(1, entry + 4)
    directory.writeUInt16LE(32, entry + 6)
    directory.writeUInt32LE(png.length, entry + 8)
    directory.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })
  return Buffer.concat([directory, ...images.map((image) => image.png)])
}

function icon(colors: [Rgb, Rgb, Rgb], fraction: (size: number) => number): Buffer {
  return encodeIco(
    [...SMALL, ...LARGE].map((size) => ({
      size,
      png: encodePng(size, drawLogo(size, fraction(size), colors)),
    })),
  )
}

if (import.meta.main) {
  const dir = join(import.meta.dir, '..', 'assets', 'icons')
  for (const [variant, colors] of Object.entries(PALETTES)) {
    const suffix = variant === 'beta' ? '-beta' : ''
    const windowIcon = icon(colors, (size) => (SMALL.includes(size) ? 1 / 2 : 3 / 4))
    await Bun.write(join(dir, `windows${suffix}.ico`), windowIcon)
    await Bun.write(
      join(dir, `windows-tray${suffix}.ico`),
      icon(colors, () => 3 / 4),
    )
  }
}
