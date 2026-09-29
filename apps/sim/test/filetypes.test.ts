import { afterAll, afterEach, describe, expect, setSystemTime, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Device } from '../src/devices'
import {
  addTyped,
  corpus,
  makeUnique,
  NAME_STYLES,
  nameFor,
  type Sample,
  seedTypedFiles,
  type TypedFile,
} from '../src/filetypes'
import { REPO_ROOT } from '../src/session'
import { AppTimeout, Cancelled } from '../src/wait'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

const samples = await corpus()
const sample = (ext: string): Sample => {
  const found = samples.find((s) => s.ext === ext)
  if (!found) throw new Error(`no sample.${ext} in the corpus`)
  return found
}
const bytesOf = (s: Sample) => readFileSync(join(REPO_ROOT, 'test/fixtures/files', s.file))

describe('the file-type corpus', () => {
  test('every sample loads with a category', () => {
    expect(samples.length).toBeGreaterThan(100)
    for (const s of samples) expect(s.category).toBeTruthy()
  })

  test('making a copy unique keeps the bytes type detection reads', () => {
    // Detection reads the first 32 bytes. Appending leaves them all, and the zip,
    // RIFF and AIFF edits change only a size or comment-length field, never the
    // signature at 0 or the form type at 8.
    for (const s of samples) {
      const original = bytesOf(s)
      const copy = Buffer.from(makeUnique(original, s))
      const end = Math.min(12, original.length)
      expect(
        copy.subarray(0, Math.min(4, end)).equals(original.subarray(0, Math.min(4, end))),
      ).toBe(true)
      if (end > 8) expect(copy.subarray(8, end).equals(original.subarray(8, end))).toBe(true)
      expect(copy.equals(Buffer.from(makeUnique(original, s)))).toBe(false)
    }
  })

  test('a zip copy keeps a valid end record, with the tag as its comment', () => {
    const copy = Buffer.from(makeUnique(bytesOf(sample('zip')), sample('zip')))
    const eocd = copy.lastIndexOf(Buffer.from([0x50, 0x4b, 5, 6]))
    expect(eocd).toBeGreaterThanOrEqual(0)
    expect(copy.readUInt16LE(eocd + 20)).toBe(copy.length - eocd - 22)
  })

  test('a RIFF copy states its new length', () => {
    const copy = Buffer.from(makeUnique(bytesOf(sample('wav')), sample('wav')))
    expect(copy.readUInt32LE(4)).toBe(copy.length - 8)
  })

  test('an MP4 copy ends with a free box of the right size', () => {
    const original = bytesOf(sample('mp4'))
    const copy = Buffer.from(makeUnique(original, sample('mp4')))
    const box = copy.subarray(original.length)
    expect(box.subarray(4, 8).toString('ascii')).toBe('free')
    expect(box.readUInt32BE(0)).toBe(box.length)
  })
})

describe('the type a bytes-first device should store', () => {
  test('the bytes win over the extension', () => {
    expect(nameFor(sample('m4v'), 'plain', 'x').expected).toBe('video/mp4')
    expect(nameFor(sample('png'), 'wrong', 'x')).toEqual({ name: 'x.txt', expected: 'image/png' })
  })

  test('a zip container takes the more specific type its extension names', () => {
    expect(nameFor(sample('docx'), 'plain', 'x').expected).toBe(sample('docx').mime)
    expect(nameFor(sample('docx'), 'none', 'x').expected).toBe('application/zip')
  })

  test('a format with no signature takes its type from the extension, whatever the name around it', () => {
    expect(nameFor(sample('md'), 'hash', 'x')).toEqual({
      name: 'x #2.md',
      expected: 'text/markdown',
    })
    expect(nameFor(sample('md'), 'upper', 'x').expected).toBe('text/markdown')
    expect(nameFor(sample('md'), 'proto', 'x')).toEqual({
      name: 'x.constructor',
      expected: 'application/octet-stream',
    })
  })

  test('a mixed run over the whole corpus names files in every style', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sim-types-'))
    dirs.push(dir)
    const files = await seedTypedFiles(dir, {
      types: ['all'],
      count: 1,
      names: 'mixed',
      prefix: 't',
    })
    expect(files.length).toBe(samples.length)
    expect(new Set(files.map((f) => f.style))).toEqual(new Set(NAME_STYLES))
  })
})

describe('adding typed files to a phone', () => {
  afterEach(() => setSystemTime())

  /** A phone whose import stays pending, and which runs `onProbe` on each look at it. */
  const stalledPhone = (onProbe = () => {}) =>
    ({
      name: 'phone',
      importFiles: async () => 'import-1',
      sql: async () => {
        onProbe()
        return [{ n: 1 }]
      },
    }) as unknown as Device
  const files = [{ path: '/nowhere/a.png' }] as TypedFile[]

  test('an import that never drains times out as the app failing', async () => {
    // The drain wait allows five minutes, so the clock jumps past them at the first look.
    const phone = stalledPhone(() => setSystemTime(new Date(Date.now() + 6 * 60_000)))
    await expect(addTyped(phone, files)).rejects.toBeInstanceOf(AppTimeout)
  })

  test('a cancelled scenario stops waiting for the import', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      addTyped(stalledPhone(), files, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(Cancelled)
  })
})
