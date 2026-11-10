import { describe, expect, test } from 'bun:test'
import { drawLogo, encodeIco, encodePng, PALETTES } from './windows-icons'

const alpha = (pixels: Uint8Array, size: number, x: number, y: number) =>
  pixels[(y * size + x) * 4 + 3]

describe('drawLogo', () => {
  test('at half width a 16 px icon has 4 px squares 4 px in from each edge', () => {
    const pixels = drawLogo(16, 1 / 2, PALETTES.standard)
    expect(alpha(pixels, 16, 3, 4)).toBe(0)
    expect(alpha(pixels, 16, 4, 4)).toBe(255)
    expect(alpha(pixels, 16, 11, 11)).toBe(255)
    expect(alpha(pixels, 16, 12, 11)).toBe(0)
  })

  test('leaves the bottom left square empty and colours the other three in order', () => {
    const pixels = drawLogo(32, 3 / 4, PALETTES.standard)
    const at = (x: number, y: number) => [
      ...pixels.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 3),
    ]
    expect(at(8, 8)).toEqual(PALETTES.standard[0])
    expect(at(20, 8)).toEqual(PALETTES.standard[1])
    expect(at(20, 20)).toEqual(PALETTES.standard[2])
    expect(alpha(pixels, 32, 8, 20)).toBe(0)
  })
})

describe('encodeIco', () => {
  test('lists each image by size, with 256 stored as 0, and points at its PNG', () => {
    const images = [16, 256].map((size) => ({
      size,
      png: encodePng(size, drawLogo(size, 1 / 2, PALETTES.beta)),
    }))
    const ico = encodeIco(images)
    expect(ico.readUInt16LE(2)).toBe(1)
    expect(ico.readUInt16LE(4)).toBe(2)
    expect([ico[6], ico[22]]).toEqual([16, 0])
    const second = ico.readUInt32LE(22 + 12)
    expect(ico.subarray(second, second + 8)).toEqual(images[1].png.subarray(0, 8))
  })
})
