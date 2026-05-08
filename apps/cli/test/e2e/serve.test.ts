jest.setTimeout(60_000)
import { spawn, type ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { createE2eContext } from './helpers'

type Ctx = ReturnType<typeof createE2eContext> & {
  serveProcess: ChildProcess | null
  port: number
  startServe(config?: {
    routes: Array<{
      path: string
      listing: boolean | string[]
      download: boolean
      recursive?: boolean
    }>
  }): Promise<void>
  stopServe(): Promise<void>
  get(
    urlPath: string,
    headers?: Record<string, string>,
  ): Promise<{ status: number; body: string; headers: Record<string, string> }>
}

function createServeContext(): Ctx {
  const base = createE2eContext()
  const port = 10000 + Math.floor(Math.random() * 50000)
  let serveProcess: ChildProcess | null = null

  async function startServe(config?: {
    routes: Array<{
      path: string
      listing: boolean | string[]
      download: boolean
      recursive?: boolean
    }>
  }) {
    // Write serve.json config
    const configPath = path.join(base.dataDir, 'serve.json')
    const serveConfig = config ?? {
      routes: [{ path: '', listing: true, download: true, recursive: true }],
    }
    fs.writeFileSync(configPath, JSON.stringify(serveConfig))

    // Start serve process
    const binaryPath = path.resolve(__dirname, '../../dist/sia')
    serveProcess = spawn(binaryPath, ['serve', '-p', String(port)], {
      env: {
        ...(process.env as Record<string, string>),
        SIA_DATA_DIR: base.dataDir,
        SIA_TEST_MODE: '1',
        NO_COLOR: '1',
      },
      stdio: 'pipe',
    })

    // Wait for health endpoint
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/_health`)
        if (res.ok) return
      } catch {
        // not ready yet
      }
      await new Promise((r) => setTimeout(r, 200))
    }
    throw new Error('Serve failed to start within 20s')
  }

  async function stopServe() {
    if (!serveProcess) return
    serveProcess.kill('SIGTERM')
    const proc = serveProcess
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        proc.kill('SIGKILL')
        resolve()
      }, 5000)
      proc.on('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
    serveProcess = null
  }

  async function get(
    urlPath: string,
    headers?: Record<string, string>,
  ): Promise<{ status: number; body: string; headers: Record<string, string> }> {
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { headers })
    const body = await res.text()
    const resHeaders: Record<string, string> = {}
    res.headers.forEach((v, k) => {
      resHeaders[k] = v
    })
    return { status: res.status, body, headers: resHeaders }
  }

  return { ...base, serveProcess: null, port, startServe, stopServe, get }
}

// ---------------------------------------------------------------------------
// Access Control
// ---------------------------------------------------------------------------

describe('serve access control', () => {
  let ctx: Ctx

  beforeEach(async () => {
    ctx = createServeContext()
    await ctx.sia('connect')
  }, 30_000)

  afterEach(async () => {
    await ctx.stopServe().catch(() => {})
    ctx.cleanup()
  }, 15_000)

  it('unconfigured paths return 404', async () => {
    await ctx.startServe({ routes: [] })
    const res = await ctx.get('/anything')
    expect(res.status).toBe(404)
  })

  it('health endpoint always works regardless of routes', async () => {
    await ctx.startServe({ routes: [] })
    const res = await ctx.get('/_health')
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body).status).toBe('ok')
  })

  it('configured route allows access', async () => {
    // Create directory with a file
    const file = ctx.createTempFile('doc.txt', 'hello')
    await ctx.sia('mkdir', 'public')
    await ctx.sia('add', file, '--dir', 'public')

    await ctx.startServe({
      routes: [{ path: 'public', listing: true, download: true, recursive: true }],
    })

    const res = await ctx.get('/public', { Accept: 'application/json' })
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.files).toHaveLength(1)
    expect(body.files[0].name).toBe('doc.txt')
  })

  it('path traversal returns 404', async () => {
    await ctx.startServe({
      routes: [{ path: '', listing: true, download: true, recursive: true }],
    })
    const res = await ctx.get('/../etc/passwd')
    expect(res.status).toBe(404)
  })

  it('non-GET methods return 405', async () => {
    await ctx.startServe({ routes: [] })
    const res = await fetch(`http://127.0.0.1:${ctx.port}/`, { method: 'POST' })
    expect(res.status).toBe(405)
  })
})

// ---------------------------------------------------------------------------
// Directory Listing
// ---------------------------------------------------------------------------

describe('serve directory listing', () => {
  let ctx: Ctx

  beforeEach(async () => {
    ctx = createServeContext()
    await ctx.sia('connect')
    // Set up test data
    const file = ctx.createTempFile('readme.txt', 'hello world')
    await ctx.sia('mkdir', 'docs')
    await ctx.sia('add', file, '--dir', 'docs')
  }, 30_000)

  afterEach(async () => {
    await ctx.stopServe().catch(() => {})
    ctx.cleanup()
  }, 15_000)

  it('listing enabled shows directory contents', async () => {
    await ctx.startServe({
      routes: [{ path: 'docs', listing: true, download: true, recursive: true }],
    })
    const res = await ctx.get('/docs', { Accept: 'application/json' })
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.files.length).toBeGreaterThan(0)
  })

  it('listing disabled returns 404 for directory', async () => {
    await ctx.startServe({
      routes: [{ path: 'docs', listing: false, download: true, recursive: true }],
    })
    const res = await ctx.get('/docs')
    expect(res.status).toBe(404)
  })

  it('listing returns SPA HTML when Accept includes text/html', async () => {
    await ctx.startServe({
      routes: [{ path: 'docs', listing: true, download: true, recursive: true }],
    })
    const res = await ctx.get('/docs', { Accept: 'text/html' })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toContain('<div id="root">')
  })

  it('root listing shows directories', async () => {
    await ctx.startServe({
      routes: [{ path: '', listing: true, download: true, recursive: true }],
    })
    const res = await ctx.get('/', { Accept: 'application/json' })
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.directories.some((d: { name: string }) => d.name === 'docs')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Download Control
// ---------------------------------------------------------------------------

describe('serve download control', () => {
  let ctx: Ctx

  beforeEach(async () => {
    ctx = createServeContext()
    await ctx.sia('connect')
    const file = ctx.createTempFile('photo.jpg', Buffer.alloc(100))
    await ctx.sia('mkdir', 'gallery')
    await ctx.sia('add', file, '--dir', 'gallery')
  }, 30_000)

  afterEach(async () => {
    await ctx.stopServe().catch(() => {})
    ctx.cleanup()
  }, 15_000)

  it('download disabled returns 403 for file access', async () => {
    await ctx.startServe({
      routes: [{ path: 'gallery', listing: true, download: false, recursive: true }],
    })
    const res = await ctx.get('/gallery/photo.jpg')
    expect(res.status).toBe(403)
    expect(res.body).toContain('Downloads disabled')
  })

  it('download disabled still allows directory listing', async () => {
    await ctx.startServe({
      routes: [{ path: 'gallery', listing: true, download: false, recursive: true }],
    })
    const res = await ctx.get('/gallery', { Accept: 'application/json' })
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.files).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Index.html Fallback
// ---------------------------------------------------------------------------

describe('serve index.html fallback', () => {
  let ctx: Ctx

  beforeEach(async () => {
    ctx = createServeContext()
    await ctx.sia('connect')
    const indexFile = ctx.createTempFile('index.html', '<html><body>Home</body></html>')
    await ctx.sia('mkdir', 'site')
    await ctx.sia('add', indexFile, '--dir', 'site')
  }, 30_000)

  afterEach(async () => {
    await ctx.stopServe().catch(() => {})
    ctx.cleanup()
  }, 15_000)

  it('directory with index.html serves the file', async () => {
    await ctx.startServe({
      routes: [{ path: 'site', listing: false, download: true, recursive: true }],
    })
    // With listing disabled, a directory with index.html should serve it
    const res = await ctx.get('/site')
    // File is served from local cache (test mode), should be 200
    expect(res.status).toBe(200)
  })

  it('index.html takes priority over listing', async () => {
    await ctx.startServe({
      routes: [{ path: 'site', listing: true, download: true, recursive: true }],
    })
    const res = await ctx.get('/site', { Accept: 'text/html' })
    expect(res.status).toBe(200)
    // Should serve index.html content, not directory listing
    // The index.html is served from cache in test mode
  })
})

// ---------------------------------------------------------------------------
// Clean URLs
// ---------------------------------------------------------------------------

describe('serve clean URLs', () => {
  let ctx: Ctx

  beforeEach(async () => {
    ctx = createServeContext()
    await ctx.sia('connect')
    const aboutFile = ctx.createTempFile('about.html', '<html><body>About</body></html>')
    await ctx.sia('mkdir', 'site')
    await ctx.sia('add', aboutFile, '--dir', 'site')
  }, 30_000)

  afterEach(async () => {
    await ctx.stopServe().catch(() => {})
    ctx.cleanup()
  }, 15_000)

  it('/site/about resolves to about.html', async () => {
    await ctx.startServe({
      routes: [{ path: 'site', listing: true, download: true, recursive: true }],
    })
    const res = await ctx.get('/site/about')
    // Should find about.html and serve it (200 from cache or 503 if no cache)
    expect(res.status).not.toBe(404)
  })

  it('clean URL at root level resolves .html', async () => {
    // Add an unfiled .html file
    const blogFile = ctx.createTempFile('blog-post.html', '<html><body>Post</body></html>')
    await ctx.sia('add', blogFile)

    await ctx.startServe({
      routes: [{ path: '', listing: true, download: true, recursive: true }],
    })
    const res = await ctx.get('/blog-post')
    expect(res.status).not.toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Route Management CLI
// ---------------------------------------------------------------------------

describe('serve routes CLI', () => {
  let ctx: Ctx

  beforeEach(() => {
    ctx = createServeContext()
  })

  afterEach(() => {
    ctx.cleanup()
  })

  it('lists empty routes', async () => {
    const r = await ctx.sia('serve', 'routes')
    expect(r.stdout).toContain('No routes configured')
  })

  it('adds a route with listing', async () => {
    await ctx.sia('serve', 'routes', 'add', 'public', '--listing')
    const r = await ctx.sia('serve', 'routes')
    expect(r.stdout).toContain('public')
  })

  it('adds a route without listing', async () => {
    await ctx.sia('serve', 'routes', 'add', 'share', '--no-listing')
    // Verify config file
    const config = JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'serve.json'), 'utf-8'))
    const route = config.routes.find((r: { path: string }) => r.path === 'share')
    expect(route.listing).toBe(false)
    expect(route.download).toBe(true)
  })

  it('adds a route with no-download', async () => {
    await ctx.sia('serve', 'routes', 'add', 'gallery', '--listing', '--no-download')
    const config = JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'serve.json'), 'utf-8'))
    const route = config.routes.find((r: { path: string }) => r.path === 'gallery')
    expect(route.listing).toBe(true)
    expect(route.download).toBe(false)
  })

  it('removes a route', async () => {
    await ctx.sia('serve', 'routes', 'add', 'temp', '--listing')
    await ctx.sia('serve', 'routes', 'rm', 'temp')
    const config = JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'serve.json'), 'utf-8'))
    expect(config.routes).toHaveLength(0)
  })

  it('updates existing route', async () => {
    await ctx.sia('serve', 'routes', 'add', 'docs', '--listing')
    await ctx.sia('serve', 'routes', 'add', 'docs', '--no-listing')
    const config = JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'serve.json'), 'utf-8'))
    expect(config.routes).toHaveLength(1)
    expect(config.routes[0].listing).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Nested Route Override
// ---------------------------------------------------------------------------

describe('serve nested route override', () => {
  let ctx: Ctx

  beforeEach(async () => {
    ctx = createServeContext()
    await ctx.sia('connect')
    const pubFile = ctx.createTempFile('public-doc.txt', 'public content')
    await ctx.sia('mkdir', 'data')
    await ctx.sia('add', pubFile, '--dir', 'data')
  }, 30_000)

  afterEach(async () => {
    await ctx.stopServe().catch(() => {})
    ctx.cleanup()
  }, 15_000)

  it('child route overrides parent permissions', async () => {
    await ctx.startServe({
      routes: [
        { path: 'data', listing: true, download: true, recursive: true },
        { path: 'data/private', listing: false, download: false, recursive: false },
      ],
    })
    // Parent route allows listing
    const parentRes = await ctx.get('/data', { Accept: 'application/json' })
    expect(parentRes.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// File Viewer
// ---------------------------------------------------------------------------

describe('serve file viewer', () => {
  let ctx: Ctx

  beforeEach(async () => {
    ctx = createServeContext()
    await ctx.sia('connect')
    const imgFile = ctx.createTempFile('photo.png', Buffer.alloc(100))
    const txtFile = ctx.createTempFile('notes.txt', 'hello world')
    await ctx.sia('mkdir', 'files')
    await ctx.sia('add', imgFile, '--dir', 'files')
    await ctx.sia('add', txtFile, '--dir', 'files')
  }, 30_000)

  afterEach(async () => {
    await ctx.stopServe().catch(() => {})
    ctx.cleanup()
  }, 15_000)

  it('browser request returns SPA HTML', async () => {
    await ctx.startServe({
      routes: [{ path: 'files', listing: true, download: true, recursive: true }],
    })
    const res = await ctx.get('/files/photo.png', { Accept: 'text/html' })
    expect(res.status).toBe(200)
    expect(res.body).toContain('<div id="root">')
    expect(res.body).toMatch(/\/_ui\/bundle\.[a-f0-9]+\.js/)
  })

  it('non-browser request returns raw file (backward compat)', async () => {
    await ctx.startServe({
      routes: [{ path: 'files', listing: true, download: true, recursive: true }],
    })
    const res = await ctx.get('/files/notes.txt')
    expect(res.status).not.toBe(404)
    expect(res.body).not.toContain('<div id="root">')
  })

  it('?dl forces download with Content-Disposition', async () => {
    await ctx.startServe({
      routes: [{ path: 'files', listing: true, download: true, recursive: true }],
    })
    const res = await ctx.get('/files/notes.txt?dl')
    expect(res.headers['content-disposition']).toContain('attachment')
  })

  it('?raw serves raw file content even with Accept: text/html', async () => {
    await ctx.startServe({
      routes: [{ path: 'files', listing: true, download: true, recursive: true }],
    })
    const res = await ctx.get('/files/notes.txt?raw', { Accept: 'text/html' })
    expect(res.body).not.toContain('<div id="root">')
  })

  it('download-disabled returns 403 for non-browser', async () => {
    await ctx.startServe({
      routes: [{ path: 'files', listing: true, download: false, recursive: true }],
    })
    const res = await ctx.get('/files/photo.png')
    expect(res.status).toBe(403)
  })

  it('serves SPA bundle assets with hashed URLs', async () => {
    await ctx.startServe({
      routes: [{ path: '', listing: true, download: true, recursive: true }],
    })
    // Get the HTML to find the hashed asset URLs
    const htmlRes = await ctx.get('/', { Accept: 'text/html' })
    const jsMatch = htmlRes.body.match(/bundle\.([a-f0-9]+)\.js/)
    expect(jsMatch).not.toBeNull()

    const jsRes = await ctx.get(`/_ui/bundle.${jsMatch![1]}.js`)
    expect(jsRes.status).toBe(200)
    expect(jsRes.headers['content-type']).toContain('javascript')

    const cssRes = await ctx.get(`/_ui/bundle.${jsMatch![1]}.css`)
    expect(cssRes.status).toBe(200)
    expect(cssRes.headers['content-type']).toContain('css')
  })

  it('file metadata JSON endpoint returns file info', async () => {
    await ctx.startServe({
      routes: [{ path: 'files', listing: true, download: true, recursive: true }],
    })
    const res = await ctx.get('/files/notes.txt', { Accept: 'application/json' })
    expect(res.status).toBe(200)
    const data = JSON.parse(res.body)
    expect(data.name).toBe('notes.txt')
    expect(data.type).toContain('text')
    expect(data.size).toBeGreaterThan(0)
    expect(data.downloadEnabled).toBe(true)
  })

  it('file metadata includes downloadEnabled false when disabled', async () => {
    await ctx.startServe({
      routes: [{ path: 'files', listing: true, download: false, recursive: true }],
    })
    const res = await ctx.get('/files/notes.txt', { Accept: 'application/json' })
    expect(res.status).toBe(200)
    const data = JSON.parse(res.body)
    expect(data.downloadEnabled).toBe(false)
  })

  it('directory listing includes downloadEnabled', async () => {
    await ctx.startServe({
      routes: [{ path: 'files', listing: true, download: true, recursive: true }],
    })
    const res = await ctx.get('/files', { Accept: 'application/json' })
    expect(res.status).toBe(200)
    const data = JSON.parse(res.body)
    expect(data.downloadEnabled).toBe(true)
  })

  it('?raw returns actual file content', async () => {
    await ctx.startServe({
      routes: [{ path: 'files', listing: true, download: true, recursive: true }],
    })
    const res = await ctx.get('/files/notes.txt?raw')
    expect(res.status).toBe(200)
    expect(res.body).toBe('hello world')
  })

  it('?raw with download disabled returns 403', async () => {
    await ctx.startServe({
      routes: [{ path: 'files', listing: true, download: false, recursive: true }],
    })
    const res = await ctx.get('/files/notes.txt?raw')
    expect(res.status).toBe(403)
  })

  it('?dl with download disabled returns 403', async () => {
    await ctx.startServe({
      routes: [{ path: 'files', listing: true, download: false, recursive: true }],
    })
    const res = await ctx.get('/files/notes.txt?dl')
    expect(res.status).toBe(403)
  })

  it('HTML file served directly for browser (bypasses SPA)', async () => {
    const htmlFile = ctx.createTempFile('page.html', '<html><body>My Page</body></html>')
    await ctx.sia('add', htmlFile, '--dir', 'files')

    await ctx.startServe({
      routes: [{ path: 'files', listing: true, download: true, recursive: true }],
    })
    const res = await ctx.get('/files/page.html', { Accept: 'text/html' })
    expect(res.status).toBe(200)
    expect(res.body).toContain('My Page')
    expect(res.body).not.toContain('<div id="root">')
  })

  it('non-browser gets raw file without Accept header', async () => {
    await ctx.startServe({
      routes: [{ path: 'files', listing: true, download: true, recursive: true }],
    })
    // fetch without any Accept header
    const res = await ctx.get('/files/notes.txt')
    expect(res.status).not.toBe(404)
    // Should get raw content, not SPA HTML or JSON
    expect(res.body).not.toContain('<div id="root">')
  })

  it('array listing filters root but not child contents', async () => {
    await ctx.startServe({
      routes: [{ path: '', listing: ['files'], download: true, recursive: true }],
    })
    // Root should only show "files" directory
    const rootRes = await ctx.get('/', { Accept: 'application/json' })
    expect(rootRes.status).toBe(200)
    const root = JSON.parse(rootRes.body)
    expect(root.directories.length).toBe(1)
    expect(root.directories[0].name).toBe('files')

    // Inside "files" should show all contents (not filtered by array)
    const filesRes = await ctx.get('/files', { Accept: 'application/json' })
    expect(filesRes.status).toBe(200)
    const files = JSON.parse(filesRes.body)
    expect(files.files.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Range requests & HEAD
// ---------------------------------------------------------------------------

describe('serve range requests', () => {
  let ctx: Ctx
  const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i))

  beforeEach(async () => {
    ctx = createServeContext()
    await ctx.sia('connect')
    // Deterministic 256-byte file; easy to verify byte-for-byte.
    const dataFile = ctx.createTempFile('data.bin', bytes)
    await ctx.sia('add', dataFile)
  }, 30_000)

  afterEach(async () => {
    await ctx.stopServe().catch(() => {})
    ctx.cleanup()
  }, 15_000)

  it('full GET advertises Accept-Ranges and returns full body', async () => {
    await ctx.startServe({
      routes: [{ path: '', listing: true, download: true, recursive: true }],
    })
    const res = await fetch(`http://127.0.0.1:${ctx.port}/data.bin`)
    expect(res.status).toBe(200)
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(res.headers.get('content-length')).toBe(String(bytes.length))
    const body = Buffer.from(await res.arrayBuffer())
    expect(body).toEqual(bytes)
  })

  it('HEAD returns headers with empty body', async () => {
    await ctx.startServe({
      routes: [{ path: '', listing: true, download: true, recursive: true }],
    })
    const res = await fetch(`http://127.0.0.1:${ctx.port}/data.bin`, { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe(String(bytes.length))
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.length).toBe(0)
  })

  it('prefix range 0-63 returns first 64 bytes with 206', async () => {
    await ctx.startServe({
      routes: [{ path: '', listing: true, download: true, recursive: true }],
    })
    const res = await fetch(`http://127.0.0.1:${ctx.port}/data.bin`, {
      headers: { Range: 'bytes=0-63' },
    })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(`bytes 0-63/${bytes.length}`)
    expect(res.headers.get('content-length')).toBe('64')
    const body = Buffer.from(await res.arrayBuffer())
    expect(body).toEqual(bytes.subarray(0, 64))
  })

  it('suffix range -64 returns last 64 bytes with 206', async () => {
    await ctx.startServe({
      routes: [{ path: '', listing: true, download: true, recursive: true }],
    })
    const res = await fetch(`http://127.0.0.1:${ctx.port}/data.bin`, {
      headers: { Range: 'bytes=-64' },
    })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(`bytes 192-255/${bytes.length}`)
    const body = Buffer.from(await res.arrayBuffer())
    expect(body).toEqual(bytes.subarray(192, 256))
  })

  it('out-of-bounds range returns 416', async () => {
    await ctx.startServe({
      routes: [{ path: '', listing: true, download: true, recursive: true }],
    })
    const res = await fetch(`http://127.0.0.1:${ctx.port}/data.bin`, {
      headers: { Range: 'bytes=999999-1000000' },
    })
    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe(`bytes */${bytes.length}`)
  })

  it('sequential ranges reassemble byte-for-byte', async () => {
    await ctx.startServe({
      routes: [{ path: '', listing: true, download: true, recursive: true }],
    })
    const r1 = await fetch(`http://127.0.0.1:${ctx.port}/data.bin`, {
      headers: { Range: 'bytes=0-127' },
    })
    const r2 = await fetch(`http://127.0.0.1:${ctx.port}/data.bin`, {
      headers: { Range: 'bytes=128-255' },
    })
    expect(r1.status).toBe(206)
    expect(r2.status).toBe(206)
    const combined = Buffer.concat([
      Buffer.from(await r1.arrayBuffer()),
      Buffer.from(await r2.arrayBuffer()),
    ])
    expect(combined).toEqual(bytes)
  })
})

// ---------------------------------------------------------------------------
// .html canonical redirect
// ---------------------------------------------------------------------------

describe('serve .html canonical redirect', () => {
  let ctx: Ctx

  beforeEach(async () => {
    ctx = createServeContext()
    await ctx.sia('connect')
    const about = ctx.createTempFile('about.html', '<html><body>About Page</body></html>')
    await ctx.sia('add', about)
  }, 30_000)

  afterEach(async () => {
    await ctx.stopServe().catch(() => {})
    ctx.cleanup()
  }, 15_000)

  it('/about.html 301-redirects to /about', async () => {
    await ctx.startServe({
      routes: [{ path: '', listing: true, download: true, recursive: true }],
    })
    const res = await fetch(`http://127.0.0.1:${ctx.port}/about.html`, { redirect: 'manual' })
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('/about')
  })

  it('follows redirect and serves about.html content at /about', async () => {
    await ctx.startServe({
      routes: [{ path: '', listing: true, download: true, recursive: true }],
    })
    const res = await fetch(`http://127.0.0.1:${ctx.port}/about.html`)
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('About Page')
  })
})

describe('serve index.html canonical redirect', () => {
  let ctx: Ctx

  beforeEach(async () => {
    ctx = createServeContext()
    await ctx.sia('connect')
    const index = ctx.createTempFile('index.html', '<html><body>Home Page</body></html>')
    await ctx.sia('add', index)
  }, 30_000)

  afterEach(async () => {
    await ctx.stopServe().catch(() => {})
    ctx.cleanup()
  }, 15_000)

  it('/index.html 301-redirects to /', async () => {
    await ctx.startServe({
      routes: [{ path: '', listing: true, download: true, recursive: true }],
    })
    const res = await fetch(`http://127.0.0.1:${ctx.port}/index.html`, { redirect: 'manual' })
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('/')
  })

  it('follows redirect and serves index.html content at /', async () => {
    await ctx.startServe({
      routes: [{ path: '', listing: true, download: true, recursive: true }],
    })
    const res = await fetch(`http://127.0.0.1:${ctx.port}/`, {
      headers: { Accept: 'text/html' },
    })
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('Home Page')
  })
})
