import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fixtureExpectations } from '../../../../test/fixtures/files/expectations'
import { detectMimeType, MAGIC_BYTES_LENGTH } from './detectMimeType'
import { getMimeTypeFromExtension } from './fileTypes'

const FIXTURES_DIR = resolve(__dirname, '..', '..', '..', '..', 'test', 'fixtures', 'files')

function listFixtureFiles(): string[] {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.startsWith('sample.'))
    .sort()
}

function readMagicBytes(filename: string): Uint8Array {
  const buf = readFileSync(join(FIXTURES_DIR, filename))
  return new Uint8Array(buf.buffer, buf.byteOffset, Math.min(buf.byteLength, MAGIC_BYTES_LENGTH))
}

const declared = Object.keys(fixtureExpectations).sort()

describe('file-type fixtures corpus', () => {
  it('every file on disk has a matching entry in expectations.ts', () => {
    const onDisk = listFixtureFiles()
    const orphanFiles = onDisk.filter((f) => !(f in fixtureExpectations))
    const orphanEntries = declared.filter((name) => !onDisk.includes(name))
    expect({ orphanFiles, orphanEntries }).toEqual({ orphanFiles: [], orphanEntries: [] })
  })

  describe.each(declared)('%s', (filename) => {
    const expected = fixtureExpectations[filename as keyof typeof fixtureExpectations]

    it(`extension resolves to ${expected.mime}`, () => {
      expect(getMimeTypeFromExtension(filename)).toBe(expected.mime)
    })

    it(
      expected.bytesMime
        ? `magic bytes resolve to ${expected.bytesMime}`
        : 'magic bytes have no rule (falls back to octet-stream)',
      () => {
        const bytes = readMagicBytes(filename)
        const detected = detectMimeType({ bytes })
        expect(detected).toBe(expected.bytesMime ?? 'application/octet-stream')
      },
    )
  })
})
