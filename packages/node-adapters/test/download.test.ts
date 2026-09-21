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

describe('a download that delivers every byte', () => {
  it('writes the file and keeps it', async () => {
    const run = adapter([new Uint8Array(512), new Uint8Array(512)])

    await run()

    expect(fs.statSync(fsIO.uri(FILE.id, FILE.type)).size).toBe(1024)
  })
})
