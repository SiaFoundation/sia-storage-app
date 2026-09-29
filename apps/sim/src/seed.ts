/**
 * Generates files to add to a device. Every file's bytes are unique, prefixed
 * with its own name, so two seeds never deduplicate against each other and a
 * test can tell from the bytes alone which file a device ended up with.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'

type SeedOptions = {
  count: number
  /** Bytes per file. */
  size: number
  /** Name prefix. Defaults to `seed`. */
  prefix?: string
}

export function parseSize(text: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*([kmg]?)b?$/i.exec(text.trim())
  if (!m) throw new Error(`Not a size: ${text} (try 512, 64k, 5m)`)
  const unit = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[
    m[2].toLowerCase() as '' | 'k' | 'm' | 'g'
  ]
  return Math.round(Number(m[1]) * unit)
}

/** The smallest file that still has random bytes after its name header. */
const MIN_SIZE = 256

export function seedFiles(dir: string, opts: SeedOptions): string[] {
  if (opts.size < MIN_SIZE) {
    throw new Error(`Seed files need at least ${MIN_SIZE} bytes to be unique, got ${opts.size}`)
  }
  mkdirSync(dir, { recursive: true })
  const prefix = opts.prefix ?? 'seed'
  const width = String(opts.count).length
  const paths: string[] = []
  for (let i = 0; i < opts.count; i++) {
    const name = `${prefix}-${String(i).padStart(width, '0')}.bin`
    const bytes = new Uint8Array(opts.size)
    crypto.getRandomValues(bytes.subarray(0, Math.min(bytes.length, 65536)))
    const header = new TextEncoder().encode(`${name}\n`)
    bytes.set(header.subarray(0, Math.min(header.length, bytes.length)))
    const path = join(dir, name)
    writeFileSync(path, bytes)
    paths.push(path)
  }
  return paths
}

/**
 * Writes `count` PNG images of random pixels, each unique, for a phone's photo
 * library. Photos needs a real image where a file import takes any bytes.
 */
export function seedPhotos(dir: string, opts: { count: number; prefix?: string }): string[] {
  mkdirSync(dir, { recursive: true })
  const prefix = opts.prefix ?? 'photo'
  const paths: string[] = []
  for (let i = 0; i < opts.count; i++) {
    const path = join(dir, `${prefix}-${i}.png`)
    writeFileSync(path, randomPng(64, 64))
    paths.push(path)
  }
  return paths
}

/** An 8-bit RGB PNG with random pixels. */
function randomPng(width: number, height: number): Uint8Array {
  const rows: Uint8Array[] = []
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(1 + width * 3)
    crypto.getRandomValues(row.subarray(1))
    rows.push(row)
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', new Uint8Array(0)),
  ])
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  typeAndData.copy(out, 4)
  out.writeUInt32BE(crc32(typeAndData) >>> 0, 8 + data.length)
  return out
}
