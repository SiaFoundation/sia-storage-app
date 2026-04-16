// Using Node's http module instead of Bun.serve because Bun strips Content-Length
// from streaming responses (ReadableStream). This causes browsers to show "Resuming..."
// and sometimes report 0 bytes for large file downloads streamed from the Sia network.
// Node's http module preserves Content-Length with res.write() streaming.
// Bun issue: https://github.com/oven-sh/bun/issues/10507
import { createReadStream } from 'fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { UNFILED_DIRECTORY_ID } from '@siastorage/core/db/operations'
import { logger } from '@siastorage/logger'
import type { CliApp } from '../app'
import {
  type ServeConfig,
  findRoute,
  isPathServed,
  canList,
  canDownload,
  isNameListed,
} from './access'
import { resolveIndexHtml, resolveCleanUrl, resolveSpaFallback } from './indexFallback'
import { UI_HASH, UI_HTML, UI_JS, UI_CSS } from './ui-bundle'

export function startHttpServer(
  app: CliApp,
  opts: { port: number; host: string },
  config: ServeConfig,
): { stop(): void } {
  const server = createServer(async (req, res) => {
    try {
      await handleRequest(app, config, req, res)
    } catch (e) {
      logger.error('serve', 'request_error', { error: e as Error })
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
      }
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
  })

  server.listen(opts.port, opts.host, () => {
    logger.info('serve', 'http_started', { port: opts.port, host: opts.host })
    console.log(`HTTP server listening on http://${opts.host}:${opts.port}`)
  })

  return {
    stop() {
      server.close()
    },
  }
}

function wantsHtml(req: IncomingMessage): boolean {
  return req.headers.accept?.includes('text/html') ?? false
}

/**
 * Returns the canonical redirect target for a .html URL, or null if already
 * canonical. `path` is the normalized path (no leading/trailing slashes);
 * `search` is url.search (includes leading '?' or empty).
 *
 *   /index.html        → /
 *   /foo/index.html    → /foo/
 *   /foo.html          → /foo
 *   /foo/bar.html      → /foo/bar
 *   /foo               → null (already canonical)
 */
export function canonicalizeHtmlUrl(path: string, search: string): string | null {
  if (path === 'index.html') return '/' + search
  if (path.endsWith('/index.html')) {
    return '/' + path.slice(0, -'index.html'.length) + search
  }
  if (path.endsWith('.html')) {
    return '/' + path.slice(0, -'.html'.length) + search
  }
  return null
}

type ParsedRange =
  | { kind: 'none' }
  | { kind: 'range'; start: number; end: number }
  | { kind: 'unsatisfiable' }

/**
 * Parse a Range header against a known total size. Supports single-range
 * `bytes=start-end`, open-ended `bytes=start-`, and suffix `bytes=-N`.
 * Multi-range (comma-separated) is rejected as unsatisfiable. `end` is
 * inclusive, matching RFC 7233.
 */
export function parseRange(header: string | undefined, size: number): ParsedRange {
  if (!header) return { kind: 'none' }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return { kind: 'unsatisfiable' }
  const [, startStr, endStr] = match
  if (size === 0) return { kind: 'unsatisfiable' }

  if (startStr === '') {
    if (endStr === '') return { kind: 'unsatisfiable' }
    const suffix = Number(endStr)
    if (!Number.isFinite(suffix) || suffix <= 0) return { kind: 'unsatisfiable' }
    const start = Math.max(0, size - suffix)
    return { kind: 'range', start, end: size - 1 }
  }

  const start = Number(startStr)
  if (!Number.isFinite(start) || start < 0 || start >= size) {
    return { kind: 'unsatisfiable' }
  }
  const end = endStr === '' ? size - 1 : Number(endStr)
  if (!Number.isFinite(end) || end < start) return { kind: 'unsatisfiable' }
  return { kind: 'range', start, end: Math.min(end, size - 1) }
}

function sendHtml(res: ServerResponse, body: string, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'text/html', Vary: 'Accept' })
  res.end(body)
}

function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data)
  res.writeHead(status, { 'Content-Type': 'application/json', Vary: 'Accept' })
  res.end(body)
}

async function handleRequest(
  app: CliApp,
  config: ServeConfig,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, { error: 'Method not allowed' }, 405)
    return
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  if (url.pathname === '/_health') {
    sendJson(res, { status: 'ok' })
    return
  }

  // Serve embedded SPA assets (hashed URLs for cache busting)
  if (url.pathname === `/_ui/bundle.${UI_HASH}.js`) {
    res.writeHead(200, {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=31536000, immutable',
    })
    res.end(UI_JS)
    return
  }
  if (url.pathname === `/_ui/bundle.${UI_HASH}.css`) {
    res.writeHead(200, {
      'Content-Type': 'text/css',
      'Cache-Control': 'public, max-age=31536000, immutable',
    })
    res.end(UI_CSS)
    return
  }

  const path = decodeURIComponent(url.pathname).replace(/^\/+/, '').replace(/\/+$/, '')

  // Block path traversal
  if (path.includes('..')) {
    sendJson(res, { error: 'Not found' }, 404)
    return
  }

  // Canonicalize .html URLs to extensionless form. Runs before access checks
  // so the canonical URL is the one subject to route permissions.
  const canonical = canonicalizeHtmlUrl(path, url.search)
  if (canonical !== null) {
    res.writeHead(301, { Location: canonical })
    res.end()
    return
  }

  // Access control: check if path has a matching route
  if (!isPathServed(path, config)) {
    sendJson(res, { error: 'Not found' }, 404)
    return
  }

  // Root path: special case since "/" isn't a directory in the database
  if (!path) {
    // Check for index.html → serve directly (HTML bypasses SPA)
    const rootIndex = await resolveIndexHtml(app, '')
    if (rootIndex) {
      if (!canDownload('', config)) {
        sendJson(res, { error: 'Downloads disabled' }, 403)
        return
      }
      await serveFile(app, rootIndex, req, res, false)
      return
    }
    // Browser → SPA
    if (wantsHtml(req)) {
      sendHtml(res, UI_HTML)
      return
    }
    if (!canList(path, config)) {
      sendJson(res, { error: 'Not found' }, 404)
      return
    }
    await rootListing(app, config, req, res)
    return
  }

  await resolvePathResponse(app, config, path, url, req, res)
}

async function rootListing(
  app: CliApp,
  config: ServeConfig,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const allDirs = await app.service.directories.getChildren(null)
  const rootRoute = findRoute('', config)!

  // Filter directories and unfiled files by listing config
  const dirs = allDirs
    .filter((d) => canList(d.path, config) && isNameListed(d.name, rootRoute))
    .map((d) => ({
      name: d.name,
      path: d.path,
      fileCount: d.fileCount,
      subdirectoryCount: d.subdirectoryCount,
    }))

  const allUnfiled = await app.service.files.queryLibrary({
    directoryId: UNFILED_DIRECTORY_ID,
    limit: 1000,
  })
  const unfiledFiles = allUnfiled.filter((f) => isNameListed(f.name, rootRoute))

  sendJson(res, {
    path: '/',
    downloadEnabled: canDownload('', config),
    directories: dirs,
    files: unfiledFiles.map((f) => ({
      name: f.name,
      type: f.type,
      size: f.size,
      updatedAt: f.updatedAt,
    })),
  })
}

async function resolvePathResponse(
  app: CliApp,
  config: ServeConfig,
  path: string,
  url: URL,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const lastSlash = path.lastIndexOf('/')
  const dirPath = lastSlash === -1 ? '' : path.substring(0, lastSlash)
  const fileName = lastSlash === -1 ? path : path.substring(lastSlash + 1)
  const route = findRoute(path, config)!

  // Step 4: If path is a file
  if (fileName) {
    const file = dirPath
      ? await app.service.files.getByNameInDirectoryPath(fileName, dirPath)
      : await findUnfiledFileByName(app, fileName)

    if (file) {
      const downloadEnabled = canDownload(path, config)

      // 4a: ?share — always raw JSON (API endpoint)
      if (url.searchParams.has('share')) {
        await serveShareMetadata(app, file, res)
        return
      }

      // 4b: ?dl — force download
      if (url.searchParams.has('dl')) {
        if (!downloadEnabled) {
          sendJson(res, { error: 'Downloads disabled' }, 403)
          return
        }
        await serveFile(app, file, req, res, true)
        return
      }

      // 4c: ?raw — serve raw file content
      if (url.searchParams.has('raw')) {
        if (!downloadEnabled) {
          sendJson(res, { error: 'Downloads disabled' }, 403)
          return
        }
        await serveFile(app, file, req, res, false)
        return
      }

      // 4d: HTML files → serve directly (bypass SPA)
      if (file.type === 'text/html' && wantsHtml(req)) {
        if (!downloadEnabled) {
          sendJson(res, { error: 'Downloads disabled' }, 403)
          return
        }
        await serveFile(app, file, req, res, false)
        return
      }

      // 4e: Browser → SPA viewer
      if (wantsHtml(req)) {
        sendHtml(res, UI_HTML)
        return
      }

      // 4f: API (Accept: application/json) → file metadata
      if (req.headers.accept?.includes('application/json')) {
        sendJson(res, {
          name: file.name,
          type: file.type,
          size: file.size,
          hash: file.hash,
          updatedAt: (file as Record<string, unknown>).updatedAt ?? 0,
          downloadEnabled,
        })
        return
      }

      // 4g: Plain request (curl) → raw file
      if (!downloadEnabled) {
        sendJson(res, { error: 'Downloads disabled, use ?share for object metadata' }, 403)
        return
      }
      await serveFile(app, file, req, res, false)
      return
    }
  }

  // Step 5: If path is a directory
  const dir = await app.service.directories.getByPath(path)
  if (dir) {
    // 5a: Check for index.html → serve directly (HTML bypasses SPA)
    const index = await resolveIndexHtml(app, path)
    if (index) {
      if (!canDownload(path, config)) {
        sendJson(res, { error: 'Downloads disabled' }, 403)
        return
      }
      await serveFile(app, index, req, res, false)
      return
    }
    // 5b: Check listing permission
    if (!canList(path, config)) {
      sendJson(res, { error: 'Not found' }, 404)
      return
    }
    // 5c: Browser → SPA, API → JSON listing
    if (wantsHtml(req)) {
      sendHtml(res, UI_HTML)
      return
    }
    const downloadEnabled = canDownload(path, config)
    await directoryListing(app, dir.id, path, config, req, res, downloadEnabled)
    return
  }

  // Step 6: Path matches nothing directly
  // 6a: Try clean URL (path + ".html") → serve directly (HTML bypasses SPA)
  if (fileName) {
    const htmlFile = await resolveCleanUrl(app, fileName, dirPath)
    if (htmlFile) {
      if (!canDownload(path, config)) {
        sendJson(res, { error: 'Downloads disabled' }, 403)
        return
      }
      await serveFile(app, htmlFile, req, res, false)
      return
    }
  }

  // 6b: SPA fallback — walk up looking for index.html within route boundary
  const spaResult = await resolveSpaFallback(app, path, route.path)
  if (spaResult) {
    if (!canDownload(spaResult.dirPath + '/index.html', config)) {
      sendJson(res, { error: 'Downloads disabled, use ?share for object metadata' }, 403)
      return
    }
    await serveFile(app, spaResult.file, req, res, false)
    return
  }

  // 6c: Nothing found — browser gets SPA (to show error), API gets 404 JSON
  if (wantsHtml(req)) {
    sendHtml(res, UI_HTML)
    return
  }
  sendJson(res, { error: 'Not found' }, 404)
}

async function serveShareMetadata(
  app: CliApp,
  file: { id: string; name: string; type: string; size: number; hash: string },
  res: ServerResponse,
): Promise<void> {
  try {
    const record = await app.service.files.getById(file.id)
    if (!record) {
      sendJson(res, { error: 'File not found' }, 404)
      return
    }
    const obj = Object.values(record.objects)[0]
    if (!obj) {
      sendJson(res, { error: 'File not uploaded to network' }, 404)
      return
    }
    const sdk = app.internal.requireSdk()
    const pinned = await sdk.getPinnedObject(obj.id)
    sendJson(res, {
      id: pinned.id(),
      size: Number(pinned.size()),
      encodedSize: Number(pinned.encodedSize()),
      createdAt: pinned.createdAt(),
      updatedAt: pinned.updatedAt(),
      slabs: pinned.slabs().map((s) => ({
        encryptionKey: Buffer.from(s.encryptionKey).toString('hex'),
        minShards: s.minShards,
        offset: s.offset,
        length: s.length,
        sectors: s.sectors,
      })),
    })
  } catch (e) {
    sendJson(res, { error: e instanceof Error ? e.message : String(e) }, 500)
  }
}

async function findUnfiledFileByName(
  app: CliApp,
  name: string,
): Promise<{ id: string; name: string; type: string; size: number; hash: string } | null> {
  const files = await app.service.files.queryLibrary({
    directoryId: UNFILED_DIRECTORY_ID,
    limit: 500,
  })
  return files.find((f) => f.name === name) ?? null
}

async function directoryListing(
  app: CliApp,
  directoryId: string,
  path: string,
  config: ServeConfig,
  req: IncomingMessage,
  res: ServerResponse,
  downloadEnabled: boolean,
): Promise<void> {
  const route = findRoute(path, config)!
  const [allChildren, allFiles] = await Promise.all([
    app.service.directories.getChildren(path),
    app.service.files.queryLibrary({ directoryId, limit: 1000 }),
  ])

  // Only apply name filtering when the route path matches this directory exactly.
  // For child directories reached via a recursive parent, show everything.
  const applyFilter = route.path === path || (route.path === '' && path === '')
  const children = applyFilter
    ? allChildren.filter((d) => isNameListed(d.name, route))
    : allChildren
  const files = applyFilter ? allFiles.filter((f) => isNameListed(f.name, route)) : allFiles

  sendJson(res, {
    path: `/${path}`,
    downloadEnabled,
    directories: children.map((d) => ({
      name: d.name,
      path: d.path,
      fileCount: d.fileCount,
      subdirectoryCount: d.subdirectoryCount,
    })),
    files: files.map((f) => ({
      name: f.name,
      type: f.type,
      size: f.size,
      updatedAt: f.updatedAt,
    })),
  })
}

async function serveFile(
  app: CliApp,
  file: { id: string; name: string; type: string; size: number; hash: string },
  req: IncomingMessage,
  res: ServerResponse,
  forceDownload: boolean,
): Promise<void> {
  const etag = `"${file.hash}"`
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304)
    res.end()
    return
  }

  const range = parseRange(req.headers.range, file.size)
  if (range.kind === 'unsatisfiable') {
    res.writeHead(416, {
      'Content-Range': `bytes */${file.size}`,
      'Content-Type': 'application/json',
    })
    res.end(JSON.stringify({ error: 'Range not satisfiable' }))
    return
  }

  const start = range.kind === 'range' ? range.start : 0
  const end = range.kind === 'range' ? range.end : file.size - 1
  const contentLength = file.size === 0 ? 0 : end - start + 1
  const status = range.kind === 'range' ? 206 : 200

  const headers: Record<string, string> = {
    'Content-Type': file.type || 'application/octet-stream',
    'Content-Length': String(contentLength),
    ETag: etag,
    'Cache-Control': 'public, max-age=3600',
    'Accept-Ranges': 'bytes',
  }
  if (range.kind === 'range') {
    headers['Content-Range'] = `bytes ${start}-${end}/${file.size}`
  }
  if (forceDownload) {
    headers['Content-Disposition'] = `attachment; filename="${file.name.replace(/"/g, '\\"')}"`
  }

  // HEAD: headers only, no body. Must short-circuit before any file read or
  // network fetch (network fetches cost real money).
  if (req.method === 'HEAD') {
    res.writeHead(status, headers)
    res.end()
    return
  }

  // Fast path: stream from local cache if available.
  const uri = await app.service.fs.getFileUri({ id: file.id, type: file.type })
  if (uri) {
    res.writeHead(status, headers)
    if (contentLength === 0) {
      res.end()
      return
    }
    await new Promise<void>((resolve) => {
      const stream = createReadStream(uri, { start, end })
      stream.on('error', (e) => {
        logger.warn('serve', 'local_stream_error', {
          fileId: file.id,
          error: e instanceof Error ? e.message : String(e),
        })
        if (!res.writableEnded) res.end()
        resolve()
      })
      stream.on('end', resolve)
      res.on('close', () => stream.destroy())
      stream.pipe(res)
    })
    return
  }

  if (!app.service.connection.getState().isConnected) {
    sendJson(res, { error: 'Not connected to indexer' }, 503)
    return
  }

  const fileRecord = await app.service.files.getById(file.id)
  if (!fileRecord) {
    sendJson(res, { error: 'File not found' }, 404)
    return
  }

  const localObject = Object.values(fileRecord.objects)[0]
  if (!localObject) {
    sendJson(res, { error: 'File not uploaded to network' }, 404)
    return
  }

  let sdk: ReturnType<typeof app.internal.requireSdk>
  try {
    sdk = app.internal.requireSdk()
  } catch (e) {
    logger.warn('serve', 'sdk_not_available', { error: e instanceof Error ? e.message : String(e) })
    sendJson(res, { error: 'SDK not available' }, 503)
    return
  }

  let pinnedObject: Awaited<ReturnType<typeof sdk.getPinnedObject>>
  try {
    pinnedObject = await sdk.getPinnedObject(localObject.id)
  } catch (e) {
    logger.warn('serve', 'get_object_failed', {
      fileId: file.id,
      objectId: localObject.id,
      error: e instanceof Error ? e.message : String(e),
    })
    sendJson(res, { error: 'Failed to resolve object from network' }, 502)
    return
  }

  logger.info('serve', 'stream_start', {
    fileId: file.id,
    name: file.name,
    offset: start,
    length: contentLength,
  })

  // Stream from the Sia network directly to the client.
  // Using Node's http module preserves Content-Length with streaming
  // (Bun.serve strips it from ReadableStream responses).
  res.writeHead(status, headers)

  try {
    const dl = await sdk.download(pinnedObject, {
      maxInflight: 4,
      offset: BigInt(start),
      length: range.kind === 'range' ? BigInt(contentLength) : undefined,
    })
    while (true) {
      const data = await dl.read()
      if (data.byteLength === 0) break
      const chunk = Buffer.from(data)
      await new Promise<void>((resolve, reject) => {
        const ok = res.write(chunk)
        if (ok) {
          resolve()
        } else {
          res.once('drain', resolve)
          res.once('error', reject)
        }
      })
    }
    await dl.cancel().catch(() => {})
    res.end()
  } catch (e) {
    logger.warn('serve', 'stream_error', {
      fileId: file.id,
      error: e instanceof Error ? e.message : String(e),
    })
    if (!res.writableEnded) {
      res.end()
    }
  }
}
