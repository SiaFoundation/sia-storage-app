import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createTestApp } from '../helpers'
import { startHttpServer, parseRange, canonicalizeHtmlUrl } from '../../src/serve/handler'
import type { ServeConfig } from '../../src/serve/access'
import type { CliApp } from '../../src/app'

let tempDir: string
let app: CliApp
let server: { stop(): void }
let port: number

const now = Date.now()

async function createFile(id: string, name: string, dirId?: string) {
  await app.service.files.create({
    id,
    name,
    type: 'text/plain',
    kind: 'file',
    size: 11,
    hash: `hash-${id}`,
    createdAt: now,
    updatedAt: now,
    localId: null,
    addedAt: now,
    trashedAt: null,
    deletedAt: null,
  })
  if (dirId) {
    await app.service.directories.moveFile(id, dirId)
  }
}

async function createHtmlFile(id: string, name: string, dirId?: string) {
  await app.service.files.create({
    id,
    name,
    type: 'text/html',
    kind: 'file',
    size: 50,
    hash: `hash-${id}`,
    createdAt: now,
    updatedAt: now,
    localId: null,
    addedAt: now,
    trashedAt: null,
    deletedAt: null,
  })
  if (dirId) {
    await app.service.directories.moveFile(id, dirId)
  }
}

/**
 * Creates a binary file record and writes the bytes to the local cache path
 * the fs adapter expects, so `app.service.fs.getFileUri()` resolves it.
 */
async function createCachedBinFile(
  id: string,
  name: string,
  bytes: Buffer,
  dirId?: string,
): Promise<void> {
  await app.service.files.create({
    id,
    name,
    type: 'application/octet-stream',
    kind: 'file',
    size: bytes.length,
    hash: `hash-${id}`,
    createdAt: now,
    updatedAt: now,
    localId: null,
    addedAt: now,
    trashedAt: null,
    deletedAt: null,
  })
  if (dirId) await app.service.directories.moveFile(id, dirId)
  const filesDir = path.join(tempDir, 'files')
  fs.mkdirSync(filesDir, { recursive: true })
  fs.writeFileSync(path.join(filesDir, `${id}.bin`), bytes)
}

function startServer(config: ServeConfig) {
  // Use a random port to avoid conflicts
  port = 10000 + Math.floor(Math.random() * 50000)
  server = startHttpServer(app, { port, host: '127.0.0.1' }, config)
}

async function get(urlPath: string, headers?: Record<string, string>): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${urlPath}`, { headers })
}

afterEach(() => {
  server?.stop()
  app?.db.close?.()
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('access control', () => {
  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-serve-handler-'))
    app = await createTestApp(tempDir)

    const dir = await app.service.directories.create('public')
    await createFile('f1', 'readme.txt', dir.id)
    const privateDir = await app.service.directories.create('private')
    await createFile('f2', 'secret.txt', privateDir.id)
  })

  it('returns 404 for paths with no matching route', async () => {
    startServer({ routes: [] })
    // Wait for server to be listening
    await new Promise((r) => setTimeout(r, 50))

    const res = await get('/private/secret.txt')
    expect(res.status).toBe(404)
  })

  it('serves files on configured routes', async () => {
    startServer({
      routes: [{ path: 'public', listing: true, download: true, recursive: true }],
    })
    await new Promise((r) => setTimeout(r, 50))

    // public route file is not available via network (no SDK) but access check passes
    // The file won't serve content (no local cache, no SDK) but it won't 404 from access control
    const publicRes = await get('/public/readme.txt')
    // Without SDK/cache, it returns 503 (not connected) — not 404
    expect(publicRes.status).not.toBe(404)

    // private route still returns 404
    const privateRes = await get('/private/secret.txt')
    expect(privateRes.status).toBe(404)
  })

  it('health endpoint always works regardless of routes', async () => {
    startServer({ routes: [] })
    await new Promise((r) => setTimeout(r, 50))

    const res = await get('/_health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
  })
})

describe('directory listing', () => {
  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-serve-handler-'))
    app = await createTestApp(tempDir)

    const dir = await app.service.directories.create('files')
    await createFile('f1', 'doc.txt', dir.id)
  })

  it('returns 404 for directory when listing is disabled', async () => {
    startServer({
      routes: [{ path: 'files', listing: false, download: true, recursive: true }],
    })
    await new Promise((r) => setTimeout(r, 50))

    const res = await get('/files')
    expect(res.status).toBe(404)
  })

  it('returns directory listing when listing is enabled', async () => {
    startServer({
      routes: [{ path: 'files', listing: true, download: true, recursive: true }],
    })
    await new Promise((r) => setTimeout(r, 50))

    const res = await get('/files', { Accept: 'application/json' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.files).toHaveLength(1)
    expect(body.files[0].name).toBe('doc.txt')
  })
})

describe('download control', () => {
  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-serve-handler-'))
    app = await createTestApp(tempDir)

    const dir = await app.service.directories.create('gallery')
    await createFile('f1', 'photo.jpg', dir.id)
  })

  it('returns 403 when download is disabled', async () => {
    startServer({
      routes: [{ path: 'gallery', listing: true, download: false, recursive: true }],
    })
    await new Promise((r) => setTimeout(r, 50))

    const res = await get('/gallery/photo.jpg')
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toContain('Downloads disabled')
  })
})

describe('path traversal', () => {
  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-serve-handler-'))
    app = await createTestApp(tempDir)
    startServer({
      routes: [{ path: '', listing: true, download: true, recursive: true }],
    })
  })

  it('blocks path traversal attempts', async () => {
    await new Promise((r) => setTimeout(r, 50))

    const res = await get('/../etc/passwd')
    expect(res.status).toBe(404)
  })
})

describe('index.html fallback', () => {
  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-serve-handler-'))
    app = await createTestApp(tempDir)

    const dir = await app.service.directories.create('site')
    await createHtmlFile('idx1', 'index.html', dir.id)
  })

  it('serves index.html for directory path', async () => {
    startServer({
      routes: [{ path: 'site', listing: true, download: true, recursive: true }],
    })
    await new Promise((r) => setTimeout(r, 50))

    // Without local cache/SDK, we get 503 — but the key check is it doesn't 404
    const res = await get('/site')
    expect(res.status).not.toBe(404)
  })
})

describe('index.html fallback at root', () => {
  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-serve-handler-'))
    app = await createTestApp(tempDir)

    await createHtmlFile('rootidx', 'index.html')
  })

  it('serves root index.html instead of the file browser UI', async () => {
    startServer({
      routes: [{ path: '', listing: true, download: true, recursive: true }],
    })
    await new Promise((r) => setTimeout(r, 50))

    // Without local cache/SDK, we get 503 — but the key check is it doesn't 200-with-SPA
    const res = await get('/', { Accept: 'text/html' })
    expect(res.status).not.toBe(404)
    // If the SPA were served, status would be 200 with text/html body of the shell.
    // The absence of a cache/SDK means serveFile fails with 503, which proves we tried
    // to serve the file rather than the SPA.
    expect(res.status).not.toBe(200)
  })

  it('returns 403 for root index.html when downloads are disabled', async () => {
    startServer({
      routes: [{ path: '', listing: true, download: false, recursive: true }],
    })
    await new Promise((r) => setTimeout(r, 50))

    const res = await get('/', { Accept: 'text/html' })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toContain('Downloads disabled')
  })
})

describe('root unfiled files', () => {
  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-serve-handler-'))
    app = await createTestApp(tempDir)

    await createHtmlFile('foo-root', 'foo.html')
  })

  it('serves /foo.html (unfiled) directly', async () => {
    startServer({
      routes: [{ path: '', listing: true, download: true, recursive: true }],
    })
    await new Promise((r) => setTimeout(r, 50))

    const res = await get('/foo.html', { Accept: 'text/html' })
    // Without SDK/cache we hit 503 — the point is it did not 404 or 200 (SPA).
    expect(res.status).not.toBe(404)
    expect(res.status).not.toBe(200)
  })

  it('resolves /foo to unfiled foo.html (clean URL)', async () => {
    startServer({
      routes: [{ path: '', listing: true, download: true, recursive: true }],
    })
    await new Promise((r) => setTimeout(r, 50))

    const res = await get('/foo', { Accept: 'text/html' })
    expect(res.status).not.toBe(404)
    expect(res.status).not.toBe(200)
  })
})

describe('root SPA deep-route fallback', () => {
  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-serve-handler-'))
    app = await createTestApp(tempDir)

    await createHtmlFile('root-idx', 'index.html')
  })

  it('falls back to unfiled root index.html for unknown deep paths', async () => {
    startServer({
      routes: [{ path: '', listing: true, download: true, recursive: true }],
    })
    await new Promise((r) => setTimeout(r, 50))

    // /nothing/here doesn't resolve to any file or directory. For a root-deployed
    // SPA this should fall back to the unfiled root index.html, not the file
    // browser SPA shell. We reach serveFile (503 without cache/SDK), which proves
    // the fallback lookup found it.
    const res = await get('/nothing/here', { Accept: 'text/html' })
    expect(res.status).not.toBe(404)
    expect(res.status).not.toBe(200)
  })
})

describe('clean URLs', () => {
  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-serve-handler-'))
    app = await createTestApp(tempDir)

    const dir = await app.service.directories.create('site')
    await createHtmlFile('about1', 'about.html', dir.id)
  })

  it('resolves /site/about to about.html', async () => {
    startServer({
      routes: [{ path: 'site', listing: true, download: true, recursive: true }],
    })
    await new Promise((r) => setTimeout(r, 50))

    // Without local cache/SDK, we get 503 — but the key check is it doesn't 404
    const res = await get('/site/about')
    expect(res.status).not.toBe(404)
  })
})

describe('parseRange', () => {
  it('returns none when header is missing', () => {
    expect(parseRange(undefined, 100)).toEqual({ kind: 'none' })
  })

  it('parses inclusive prefix range', () => {
    expect(parseRange('bytes=0-9', 100)).toEqual({ kind: 'range', start: 0, end: 9 })
  })

  it('parses open-ended range', () => {
    expect(parseRange('bytes=50-', 100)).toEqual({ kind: 'range', start: 50, end: 99 })
  })

  it('parses suffix range', () => {
    expect(parseRange('bytes=-10', 100)).toEqual({ kind: 'range', start: 90, end: 99 })
  })

  it('clamps end to size-1', () => {
    expect(parseRange('bytes=0-999', 100)).toEqual({ kind: 'range', start: 0, end: 99 })
  })

  it('rejects malformed header', () => {
    expect(parseRange('bytes=abc', 100)).toEqual({ kind: 'unsatisfiable' })
    expect(parseRange('lines=0-9', 100)).toEqual({ kind: 'unsatisfiable' })
    expect(parseRange('bytes=0-9,10-19', 100)).toEqual({ kind: 'unsatisfiable' })
  })

  it('rejects start >= size', () => {
    expect(parseRange('bytes=100-', 100)).toEqual({ kind: 'unsatisfiable' })
    expect(parseRange('bytes=200-300', 100)).toEqual({ kind: 'unsatisfiable' })
  })

  it('rejects end < start', () => {
    expect(parseRange('bytes=50-49', 100)).toEqual({ kind: 'unsatisfiable' })
  })

  it('rejects zero-size file with any range', () => {
    expect(parseRange('bytes=0-0', 0)).toEqual({ kind: 'unsatisfiable' })
  })

  it('rejects suffix of zero', () => {
    expect(parseRange('bytes=-0', 100)).toEqual({ kind: 'unsatisfiable' })
  })
})

describe('canonicalizeHtmlUrl', () => {
  it('returns null for paths without .html', () => {
    expect(canonicalizeHtmlUrl('foo', '')).toBeNull()
    expect(canonicalizeHtmlUrl('foo/bar', '?x=1')).toBeNull()
    expect(canonicalizeHtmlUrl('', '')).toBeNull()
    expect(canonicalizeHtmlUrl('foo.htmlx', '')).toBeNull()
  })

  it('strips .html from simple paths', () => {
    expect(canonicalizeHtmlUrl('foo.html', '')).toBe('/foo')
    expect(canonicalizeHtmlUrl('dir/foo.html', '')).toBe('/dir/foo')
  })

  it('strips index.html from root', () => {
    expect(canonicalizeHtmlUrl('index.html', '')).toBe('/')
  })

  it('strips index.html from subdirectory (keeping trailing slash)', () => {
    expect(canonicalizeHtmlUrl('dir/index.html', '')).toBe('/dir/')
    expect(canonicalizeHtmlUrl('a/b/index.html', '')).toBe('/a/b/')
  })

  it('preserves query string', () => {
    expect(canonicalizeHtmlUrl('foo.html', '?x=1&y=2')).toBe('/foo?x=1&y=2')
    expect(canonicalizeHtmlUrl('index.html', '?ref=home')).toBe('/?ref=home')
  })
})

describe('.html URL canonicalization via HTTP', () => {
  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-serve-handler-'))
    app = await createTestApp(tempDir)
  })

  async function getManual(urlPath: string, headers?: Record<string, string>): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}${urlPath}`, { headers, redirect: 'manual' })
  }

  it('redirects /foo.html to /foo', async () => {
    startServer({ routes: [{ path: '', listing: true, download: true, recursive: true }] })
    await new Promise((r) => setTimeout(r, 50))

    const res = await getManual('/foo.html')
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('/foo')
  })

  it('redirects /dir/foo.html to /dir/foo', async () => {
    startServer({ routes: [{ path: '', listing: true, download: true, recursive: true }] })
    await new Promise((r) => setTimeout(r, 50))

    const res = await getManual('/dir/foo.html')
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('/dir/foo')
  })

  it('redirects /index.html to /', async () => {
    startServer({ routes: [{ path: '', listing: true, download: true, recursive: true }] })
    await new Promise((r) => setTimeout(r, 50))

    const res = await getManual('/index.html')
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('/')
  })

  it('redirects /dir/index.html to /dir/', async () => {
    startServer({ routes: [{ path: '', listing: true, download: true, recursive: true }] })
    await new Promise((r) => setTimeout(r, 50))

    const res = await getManual('/dir/index.html')
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('/dir/')
  })

  it('preserves query string on redirect', async () => {
    startServer({ routes: [{ path: '', listing: true, download: true, recursive: true }] })
    await new Promise((r) => setTimeout(r, 50))

    const res = await getManual('/foo.html?x=1&y=2')
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('/foo?x=1&y=2')
  })

  it('redirect fires before access check (no route needed)', async () => {
    startServer({ routes: [] })
    await new Promise((r) => setTimeout(r, 50))

    const res = await getManual('/foo.html')
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('/foo')
  })

  it('does not redirect paths without .html extension', async () => {
    startServer({ routes: [{ path: '', listing: true, download: true, recursive: true }] })
    await new Promise((r) => setTimeout(r, 50))

    const res = await getManual('/foo')
    // No redirect; goes through normal resolution (404 since nothing exists).
    expect(res.status).not.toBe(301)
  })
})

describe('range and HEAD over HTTP', () => {
  const bytes = Buffer.from(Array.from({ length: 100 }, (_, i) => i % 256))

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-serve-handler-'))
    app = await createTestApp(tempDir)
    await createCachedBinFile('bin1', 'data.bin', bytes)
  })

  it('serves full file with Accept-Ranges header', async () => {
    startServer({ routes: [{ path: '', listing: true, download: true, recursive: true }] })
    await new Promise((r) => setTimeout(r, 50))

    const res = await get('/data.bin')
    expect(res.status).toBe(200)
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(res.headers.get('content-length')).toBe(String(bytes.length))
    const body = Buffer.from(await res.arrayBuffer())
    expect(body).toEqual(bytes)
  })

  it('serves prefix range 0-9', async () => {
    startServer({ routes: [{ path: '', listing: true, download: true, recursive: true }] })
    await new Promise((r) => setTimeout(r, 50))

    const res = await get('/data.bin', { Range: 'bytes=0-9' })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(`bytes 0-9/${bytes.length}`)
    expect(res.headers.get('content-length')).toBe('10')
    const body = Buffer.from(await res.arrayBuffer())
    expect(body).toEqual(bytes.subarray(0, 10))
  })

  it('serves open-ended range 50-', async () => {
    startServer({ routes: [{ path: '', listing: true, download: true, recursive: true }] })
    await new Promise((r) => setTimeout(r, 50))

    const res = await get('/data.bin', { Range: 'bytes=50-' })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(`bytes 50-99/${bytes.length}`)
    const body = Buffer.from(await res.arrayBuffer())
    expect(body).toEqual(bytes.subarray(50, 100))
  })

  it('serves suffix range -10 (last 10 bytes)', async () => {
    startServer({ routes: [{ path: '', listing: true, download: true, recursive: true }] })
    await new Promise((r) => setTimeout(r, 50))

    const res = await get('/data.bin', { Range: 'bytes=-10' })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(`bytes 90-99/${bytes.length}`)
    const body = Buffer.from(await res.arrayBuffer())
    expect(body).toEqual(bytes.subarray(90, 100))
  })

  it('returns 416 for unsatisfiable range', async () => {
    startServer({ routes: [{ path: '', listing: true, download: true, recursive: true }] })
    await new Promise((r) => setTimeout(r, 50))

    const res = await get('/data.bin', { Range: 'bytes=200-300' })
    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe(`bytes */${bytes.length}`)
  })

  it('returns 416 for malformed range', async () => {
    startServer({ routes: [{ path: '', listing: true, download: true, recursive: true }] })
    await new Promise((r) => setTimeout(r, 50))

    const res = await get('/data.bin', { Range: 'bytes=abc' })
    expect(res.status).toBe(416)
  })

  it('reassembles file from sequential ranges byte-for-byte', async () => {
    startServer({ routes: [{ path: '', listing: true, download: true, recursive: true }] })
    await new Promise((r) => setTimeout(r, 50))

    const first = await get('/data.bin', { Range: 'bytes=0-49' })
    const second = await get('/data.bin', { Range: 'bytes=50-99' })
    expect(first.status).toBe(206)
    expect(second.status).toBe(206)
    const combined = Buffer.concat([
      Buffer.from(await first.arrayBuffer()),
      Buffer.from(await second.arrayBuffer()),
    ])
    expect(combined).toEqual(bytes)
  })

  it('HEAD returns headers with empty body', async () => {
    startServer({ routes: [{ path: '', listing: true, download: true, recursive: true }] })
    await new Promise((r) => setTimeout(r, 50))

    const res = await fetch(`http://127.0.0.1:${port}/data.bin`, { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe(String(bytes.length))
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.length).toBe(0)
  })

  it('HEAD with Range returns 206 headers, empty body', async () => {
    startServer({ routes: [{ path: '', listing: true, download: true, recursive: true }] })
    await new Promise((r) => setTimeout(r, 50))

    const res = await fetch(`http://127.0.0.1:${port}/data.bin`, {
      method: 'HEAD',
      headers: { Range: 'bytes=0-9' },
    })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(`bytes 0-9/${bytes.length}`)
    expect(res.headers.get('content-length')).toBe('10')
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.length).toBe(0)
  })

  it('If-None-Match returns 304', async () => {
    startServer({ routes: [{ path: '', listing: true, download: true, recursive: true }] })
    await new Promise((r) => setTimeout(r, 50))

    const res = await get('/data.bin', { 'If-None-Match': '"hash-bin1"' })
    expect(res.status).toBe(304)
  })

  it('Range combined with ?dl returns 206 + Content-Disposition', async () => {
    startServer({ routes: [{ path: '', listing: true, download: true, recursive: true }] })
    await new Promise((r) => setTimeout(r, 50))

    const res = await get('/data.bin?dl', { Range: 'bytes=0-9' })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-disposition')).toContain('attachment')
    expect(res.headers.get('content-disposition')).toContain('data.bin')
  })
})

describe('method filtering', () => {
  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-serve-handler-'))
    app = await createTestApp(tempDir)
    startServer({ routes: [] })
  })

  it('returns 405 for non-GET/HEAD methods', async () => {
    await new Promise((r) => setTimeout(r, 50))

    const res = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST' })
    expect(res.status).toBe(405)
  })
})
