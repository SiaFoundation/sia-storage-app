/**
 * Real files of every type the app knows, for checking that each one keeps its
 * name and type on every device. The bytes come from the repo's file-type
 * corpus in test/fixtures/files, one sample per extension, and each copy is
 * made unique in a way its format tolerates, so a decoder still reads it and
 * two copies never deduplicate.
 *
 * The type a device should store is worked out from the corpus's own
 * expectations, not by calling the code under test, so a bug in that code
 * cannot pass by agreeing with itself. The rule matches the core's bytes-first
 * detection, which the daemon's add and a phone's import both follow: the
 * format the bytes carry wins, the extension decides only when the bytes have
 * no signature, and a zip or Matroska container takes the extension's more
 * specific type when the extension names one.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileHash, sha256 } from './integrity'
import type { Device } from './devices'
import { REPO_ROOT } from './session'
import { waitForApp } from './wait'

const CORPUS = join(REPO_ROOT, 'test/fixtures/files')

export type Category = 'image' | 'video' | 'audio' | 'text' | 'document' | 'archive' | 'installer'

export type Sample = {
  file: string
  ext: string
  mime: string
  /** What the bytes alone say, or null for a format with no signature. */
  bytesMime: string | null
  /** A hand-written magic prefix rather than a file a program can open. */
  stub: boolean
  category: Category
}

/** How a generated file is named, each one a shape a past bug turned on. */
export type NameStyle =
  | 'plain'
  | 'upper'
  | 'none'
  | 'wrong'
  | 'spaces'
  | 'unicode'
  | 'hash'
  | 'double'
  | 'proto'

export const NAME_STYLES: NameStyle[] = [
  'plain',
  'upper',
  'none',
  'wrong',
  'spaces',
  'unicode',
  'hash',
  'double',
  'proto',
]

export type TypedFile = {
  path: string
  name: string
  sample: Sample
  style: NameStyle
  /** The type a device that detects from bytes first should store. */
  expected: string
}

const DOCUMENTS = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/rtf',
  'application/vnd.apple.pages',
  'application/vnd.apple.numbers',
  'application/vnd.apple.keynote',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/epub+zip',
  'application/x-mobipocket-ebook',
  'application/vnd.amazon.ebook',
])

const ARCHIVES = new Set([
  'application/zip',
  'application/gzip',
  'application/x-tar',
  'application/x-7z-compressed',
  'application/vnd.rar',
  'application/x-bzip2',
  'application/x-xz',
  'application/zstd',
  'application/x-iso9660-image',
  'application/vnd.ms-cab-compressed',
])

const TEXT_APPLICATION = new Set(['application/json', 'application/yaml', 'application/toml'])

/** Zip-based types whose zip bytes take the extension's type, as the core refines them. */
const ZIP_REFINED = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/epub+zip',
  'application/vnd.android.package-archive',
])

function categoryOf(mime: string): Category {
  if (mime === 'image/svg+xml') return 'text'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('text/') || TEXT_APPLICATION.has(mime)) return 'text'
  if (DOCUMENTS.has(mime)) return 'document'
  if (ARCHIVES.has(mime)) return 'archive'
  return 'installer'
}

/** Every sample in the corpus, as its expectations file describes it. */
export async function corpus(): Promise<Sample[]> {
  const { fixtureExpectations } = (await import(join(CORPUS, 'expectations.ts'))) as {
    fixtureExpectations: Record<string, { mime: string; bytesMime: string | null; source: string }>
  }
  return Object.entries(fixtureExpectations).map(([file, e]) => ({
    file,
    ext: file.slice(file.indexOf('.') + 1),
    mime: e.mime,
    bytesMime: e.bytesMime,
    stub: e.source === 'stub',
    category: categoryOf(e.mime),
  }))
}

/** Samples matching any of `types`: `all`, a category, a MIME type, or an extension. */
function selectSamples(samples: Sample[], types: string[]): Sample[] {
  const wanted = types.map((t) => t.trim().toLowerCase().replace(/^\./, ''))
  const picked = samples.filter((s) =>
    wanted.some((t) => t === 'all' || t === s.category || t === s.mime || t === s.ext),
  )
  if (picked.length === 0) {
    throw new Error(
      `No corpus sample matches ${types.join(', ')}. Try all, a category, a MIME type or an extension.`,
    )
  }
  return picked
}

/** The type a bytes-first device stores for a sample named with its own extension. */
function withOwnExtension(s: Sample): string {
  if (s.bytesMime === null) return s.mime
  if (s.bytesMime === 'application/zip' && ZIP_REFINED.has(s.mime)) return s.mime
  if (s.bytesMime === 'video/x-matroska' && s.mime === 'video/webm') return s.mime
  return s.bytesMime
}

/** Whether `style` can name `s` and still test what the style is for. */
function styleFits(s: Sample, style: NameStyle): boolean {
  if (style === 'wrong') return s.bytesMime !== null
  if (style === 'double') return ['gz', 'bz2', 'xz'].includes(s.ext)
  if (style === 'proto') return s.bytesMime === null
  return true
}

/** The file name for a sample in a style, and the type a bytes-first device should store for it. */
export function nameFor(
  s: Sample,
  style: NameStyle,
  base: string,
): { name: string; expected: string } {
  const own = withOwnExtension(s)
  switch (style) {
    case 'plain':
      return { name: `${base}.${s.ext}`, expected: own }
    case 'upper':
      return { name: `${base}.${s.ext.toUpperCase()}`, expected: own }
    case 'spaces':
      return { name: `${base} with spaces.${s.ext}`, expected: own }
    case 'unicode':
      return { name: `${base}-café-日本.${s.ext}`, expected: own }
    // A `#` or `?` is part of a file name, so the extension after it still names the type.
    case 'hash':
      return { name: `${base} #2.${s.ext}`, expected: own }
    case 'none':
      return { name: base, expected: s.bytesMime ?? 'application/octet-stream' }
    // Named as text: the bytes' own format still wins.
    case 'wrong':
      return { name: `${base}.txt`, expected: s.bytesMime ?? 'text/plain' }
    case 'double':
      return { name: `${base}.tar.${s.ext}`, expected: own }
    // An extension named like a property every JavaScript object inherits, such
    // as `constructor`, names no type.
    case 'proto':
      return { name: `${base}.constructor`, expected: 'application/octet-stream' }
  }
}

function random(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n))
}

const ZIP_FAMILY = /^(zip|docx|xlsx|pptx|epub|apk|odt|ods|odp|pages|numbers|key|jar)$/
const ISO_BMFF = /^(mp4|m4v|mov|qt|3gp|3g2|heic|heif|heics|avif|avci|avcs|m4a|m4b|cr3)$/
const RIFF = /^(webp|wav|avi)$/

/**
 * `bytes` with something unique added where its format allows it, so readers
 * still open it: the zip comment, a `free` box after an MP4-family file's
 * boxes, a `JUNK` chunk in a RIFF file with its size fixed, an `APPL` chunk in
 * an AIFF, trailing whitespace in text, and trailing bytes elsewhere, which
 * image, audio and PDF readers ignore.
 */
export function makeUnique(bytes: Uint8Array, s: Sample): Uint8Array {
  const tag = random(16)
  const hex = Buffer.from(tag).toString('hex')
  if (s.category === 'text') {
    // Spaces and tabs spell the tag in bits, which every text format ignores at the end.
    const bits = [...tag].flatMap((b) => [...Array(8)].map((_, i) => ((b >> i) & 1 ? '\t' : ' ')))
    return Buffer.concat([bytes, Buffer.from(`\n${bits.join('')}\n`)])
  }
  if (!s.stub && ZIP_FAMILY.test(s.ext)) {
    // The end-of-central-directory record is the last 22 bytes when there is no comment.
    const eocd = bytes.length - 22
    if (eocd >= 0 && bytes[eocd] === 0x50 && bytes[eocd + 1] === 0x4b && bytes[eocd + 2] === 5) {
      const out = Buffer.concat([bytes, Buffer.from(hex)])
      out.writeUInt16LE(hex.length, eocd + 20)
      return out
    }
  }
  if (!s.stub && ISO_BMFF.test(s.ext)) {
    const box = Buffer.alloc(8 + tag.length)
    box.writeUInt32BE(box.length, 0)
    box.write('free', 4, 'ascii')
    Buffer.from(tag).copy(box, 8)
    return Buffer.concat([bytes, box])
  }
  if (!s.stub && RIFF.test(s.ext)) {
    const chunk = Buffer.alloc(8 + tag.length)
    chunk.write('JUNK', 0, 'ascii')
    chunk.writeUInt32LE(tag.length, 4)
    Buffer.from(tag).copy(chunk, 8)
    const out = Buffer.concat([bytes, chunk])
    out.writeUInt32LE(out.length - 8, 4)
    return out
  }
  if (!s.stub && /^(aiff|aif|aifc)$/.test(s.ext)) {
    const chunk = Buffer.alloc(8 + tag.length)
    chunk.write('APPL', 0, 'ascii')
    chunk.writeUInt32BE(tag.length, 4)
    Buffer.from(tag).copy(chunk, 8)
    const out = Buffer.concat([bytes, chunk])
    out.writeUInt32BE(out.length - 8, 4)
    return out
  }
  return Buffer.concat([bytes, tag])
}

/**
 * Adds files to a device through its own add path, a phone's in batches: the
 * picker's import takes many files at once, and one import per file would
 * make a whole corpus take minutes. A phone whose import never drains times
 * out as the app's failure, and `signal` stops the wait when a scenario is
 * cancelled.
 */
export async function addTyped(
  device: Device,
  files: TypedFile[],
  opts: { dir?: string; signal?: AbortSignal } = {},
): Promise<void> {
  const { dir, signal } = opts
  const phone = device as Device & {
    importFiles?(paths: string[], opts?: { dir?: string }): Promise<string>
  }
  if (phone.importFiles) {
    const imports: string[] = []
    for (let i = 0; i < files.length; i += 25) {
      imports.push(
        await phone.importFiles(
          files.slice(i, i + 25).map((f) => f.path),
          { dir },
        ),
      )
    }
    // importFiles returns once the files are staged, and a converge that
    // starts before the rest land passes on the ones that have.
    await waitForApp(
      `${device.name} to finish importing ${files.length} files`,
      async () => {
        const [row] = await device.sql<{ n: number }>(
          `SELECT count(*) AS n FROM import_files
           WHERE importId IN (${imports.map(() => '?').join(', ')})
             AND state IN ('pending', 'active')`,
          ...imports,
        )
        return row?.n === 0 ? true : undefined
      },
      { timeoutMs: 5 * 60_000, intervalMs: 1000, signal },
    )
    return
  }
  for (const f of files) await device.addFile(f.path, { dir })
}

/**
 * Writes `count` files for each sample `types` selects. `names` picks one
 * style, or a list, or `mixed` for all of them, and each sample takes a style in
 * turn from those that fit it, so every style appears in a run over the whole
 * corpus.
 */
export async function seedTypedFiles(
  dir: string,
  opts: {
    types: string[]
    count: number
    names: NameStyle | NameStyle[] | 'mixed'
    prefix: string
  },
): Promise<TypedFile[]> {
  mkdirSync(dir, { recursive: true })
  const samples = selectSamples(await corpus(), opts.types)
  const out: TypedFile[] = []
  let turn = 0
  for (const s of samples) {
    for (let i = 0; i < opts.count; i++) {
      const pool =
        opts.names === 'mixed' ? NAME_STYLES : Array.isArray(opts.names) ? opts.names : [opts.names]
      const fitting = pool.filter((st) => styleFits(s, st))
      const style: NameStyle = fitting.length > 0 ? fitting[turn++ % fitting.length] : 'plain'
      const base = `${opts.prefix}-${s.ext}-${i}`
      const { name, expected } = nameFor(s, style, base)
      const path = join(dir, name)
      writeFileSync(path, makeUnique(readFileSync(join(CORPUS, s.file)), s))
      out.push({ path, name, sample: s, style, expected })
    }
  }
  return out
}

export type TypeProblems = {
  /** Files the device has no row for under the exact name. */
  missing: string[]
  /** `name: stored, expected`. */
  wrongType: string[]
  /**
   * Files whose recorded hash, the files.hash column, is not the sha256 of the
   * bytes that were added. The bytes the device holds are not read.
   */
  wrongHash: string[]
}

/** How the files a device holds differ from the typed files that were added. */
export async function typeProblems(
  device: Device,
  files: TypedFile[],
  expectedOf: (f: TypedFile) => string = (f) => f.expected,
): Promise<TypeProblems> {
  const rows = await device.sql<{ name: string; type: string; hash: string }>(
    "SELECT name, type, hash FROM files WHERE kind = 'file' AND deletedAt IS NULL",
  )
  const byName = new Map(rows.map((r) => [r.name, r]))
  const out: TypeProblems = { missing: [], wrongType: [], wrongHash: [] }
  for (const f of files) {
    const row = byName.get(f.name)
    if (!row) {
      out.missing.push(f.name)
      continue
    }
    if (row.type !== expectedOf(f))
      out.wrongType.push(`${f.name}: ${row.type}, expected ${expectedOf(f)}`)
    if (fileHash(row.hash) !== sha256(readFileSync(f.path))) out.wrongHash.push(f.name)
  }
  return out
}

/**
 * The JPEG and PNG files, which every platform's thumbnailer decodes from this
 * corpus. The corpus's GIF and WebP samples are the smallest valid files of
 * their formats, which libvips, the daemon's decoder, refuses, and its AVIF
 * sample is a stub.
 */
export function commonImages(files: TypedFile[]): TypedFile[] {
  return files.filter((f) => !f.sample.stub && ['image/jpeg', 'image/png'].includes(f.expected))
}

/** The names of files on `device` that have a thumbnail row. */
export async function thumbnailed(device: Device): Promise<Set<string>> {
  const rows = await device.sql<{ name: string }>(
    "SELECT f.name FROM files f WHERE f.kind = 'file' AND EXISTS (SELECT 1 FROM files t WHERE t.kind = 'thumb' AND t.thumbForId = f.id)",
  )
  return new Set(rows.map((r) => r.name))
}
