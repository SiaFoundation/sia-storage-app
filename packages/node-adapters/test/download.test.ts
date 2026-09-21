import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createNodeDownloadAdapter } from '../src/download'
import { createNodeFsIO } from '../src/fsIO'

/*
 * A download that stops early must fail rather than finalize what it got.
 *
 * The stream signals its end with a read of nothing, and the SDK's contract
 * says a cancelled download resolves the same way rather than raising, so a
 * caller reading until it gets nothing cannot tell a truncated transfer from
 * a finished one.
 */

const FILE = { id: 'vid1', type: 'video/quicktime', size: 1024 }

/** Hands out `chunks` in order, then reads of nothing forever. */
function stream(chunks: Uint8Array[]) {
  let i = 0
  return {
    read: async () => (i < chunks.length ? chunks[i++] : new Uint8Array(0)),
    cancel: async () => {},
  }
}

function sdkYielding(chunks: Uint8Array[]) {
  return {
    openAppKey: () => ({}),
    openPinnedObject: () => ({}),
    download: async () => stream(chunks),
  } as never
}

let filesDir: string
let fsIO: ReturnType<typeof createNodeFsIO>

beforeEach(() => {
  filesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-download-test-'))
  fsIO = createNodeFsIO(filesDir)
})

afterEach(() => {
  fs.rmSync(filesDir, { recursive: true, force: true })
})

function adapter(chunks: Uint8Array[]) {
  const download = createNodeDownloadAdapter({
    fsIO,
    getAppKey: async () => new Uint8Array([1, 2, 3]),
  })
  return () =>
    download.download({
      file: FILE,
      object: { indexerURL: 'https://indexer.test', id: 'obj1' } as never,
      sdk: sdkYielding(chunks),
      onProgress: () => {},
      signal: new AbortController().signal,
    })
}

describe('a download that ends early', () => {
  it('fails instead of reporting a short file as complete', async () => {
    const run = adapter([new Uint8Array(256)])

    await expect(run()).rejects.toThrow('Download ended at 256 of 1024 bytes')
  })

  it('leaves no partial file behind for the app to treat as downloaded', async () => {
    const run = adapter([new Uint8Array(256)])

    await expect(run()).rejects.toThrow()

    expect(fs.existsSync(fsIO.uri(FILE.id, FILE.type))).toBe(false)
  })

  it('fails when the stream stops between chunks, not only on the first', async () => {
    const run = adapter([new Uint8Array(512), new Uint8Array(256)])

    await expect(run()).rejects.toThrow('Download ended at 768 of 1024 bytes')
  })
})

describe('a download the caller aborted', () => {
  it('does not report the bytes it never asked for as a short file', async () => {
    const controller = new AbortController()
    controller.abort()
    const download = createNodeDownloadAdapter({
      fsIO,
      getAppKey: async () => new Uint8Array([1, 2, 3]),
    })

    // The stream ends where the abort left it. Calling that a truncation
    // would report a cancellation the caller asked for as a failure.
    await download.download({
      file: FILE,
      object: { indexerURL: 'https://indexer.test', id: 'obj1' } as never,
      sdk: sdkYielding([new Uint8Array(256)]),
      onProgress: () => {},
      signal: controller.signal,
    })
  })
})

describe('a ranged download', () => {
  /*
   * The system reads an extent's position from where its bytes sit in the
   * file and treats anything past the file's end as absent, so a range
   * written at the front reads back as a file ending where the range does.
   */
  it('writes the bytes at their own offset, leaving a hole before them', async () => {
    const payload = new Uint8Array(256).fill(7)
    const download = createNodeDownloadAdapter({
      fsIO,
      getAppKey: async () => new Uint8Array([1, 2, 3]),
    })
    const dest = path.join(filesDir, 'ranged.bin')

    const bytes = await download.downloadRangeToPath!({
      object: { indexerURL: 'https://indexer.test', id: 'obj1' } as never,
      sdk: sdkYielding([payload]),
      destPath: dest,
      offset: 1024,
      length: 256,
      signal: new AbortController().signal,
    })

    expect(bytes).toBe(256)
    const written = fs.readFileSync(dest)
    expect(written.length).toBe(1280)
    expect(written.subarray(1024, 1280)).toEqual(Buffer.from(payload))
  })

  it('replaces a symlink at the destination instead of writing through it', async () => {
    const outside = path.join(filesDir, 'outside.bin')
    fs.writeFileSync(outside, 'untouched')
    const dest = path.join(filesDir, 'linked.bin')
    fs.symlinkSync(outside, dest)
    const download = createNodeDownloadAdapter({
      fsIO,
      getAppKey: async () => new Uint8Array([1, 2, 3]),
    })

    await download.downloadRangeToPath!({
      object: { indexerURL: 'https://indexer.test', id: 'obj1' } as never,
      sdk: sdkYielding([new Uint8Array(64).fill(9)]),
      destPath: dest,
      offset: 0,
      length: 64,
      signal: new AbortController().signal,
    })

    expect(fs.readFileSync(outside, 'utf8')).toBe('untouched')
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(false)
  })
})

describe('a download that delivers every byte', () => {
  it('writes the file and keeps it', async () => {
    const run = adapter([new Uint8Array(512), new Uint8Array(512)])

    await run()

    expect(fs.statSync(fsIO.uri(FILE.id, FILE.type)).size).toBe(1024)
  })
})
