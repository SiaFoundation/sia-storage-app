import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createTestApp } from '../helpers'
import {
  resolveIndexHtml,
  resolveCleanUrl,
  resolveSpaFallback,
} from '../../src/serve/indexFallback'
import type { CliApp } from '../../src/app'

let tempDir: string
let app: CliApp

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-serve-index-'))
  app = await createTestApp(tempDir)
})

afterEach(() => {
  app.db.close?.()
  fs.rmSync(tempDir, { recursive: true, force: true })
})

const now = Date.now()

async function createFile(id: string, name: string, dirId?: string) {
  await app.service.files.create({
    id,
    name,
    type: 'text/html',
    kind: 'file',
    size: 100,
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

describe('resolveIndexHtml', () => {
  it('returns index.html file from a directory', async () => {
    const dir = await app.service.directories.create('site')
    await createFile('idx1', 'index.html', dir.id)

    const result = await resolveIndexHtml(app, 'site')
    expect(result).not.toBeNull()
    expect(result!.name).toBe('index.html')
  })

  it('returns null when no index.html exists', async () => {
    await app.service.directories.create('empty')
    const result = await resolveIndexHtml(app, 'empty')
    expect(result).toBeNull()
  })

  it('returns unfiled index.html at the root', async () => {
    await createFile('root-idx', 'index.html')
    const result = await resolveIndexHtml(app, '')
    expect(result).not.toBeNull()
    expect(result!.name).toBe('index.html')
  })

  it('returns null at the root when no unfiled index.html exists', async () => {
    const result = await resolveIndexHtml(app, '')
    expect(result).toBeNull()
  })
})

describe('resolveCleanUrl', () => {
  it('resolves filename.html for a clean URL', async () => {
    const dir = await app.service.directories.create('site')
    await createFile('about1', 'about.html', dir.id)

    const result = await resolveCleanUrl(app, 'about', 'site')
    expect(result).not.toBeNull()
    expect(result!.name).toBe('about.html')
  })

  it('returns null when .html file does not exist', async () => {
    await app.service.directories.create('site')
    const result = await resolveCleanUrl(app, 'missing', 'site')
    expect(result).toBeNull()
  })

  it('resolves unfiled filename.html at the root', async () => {
    await createFile('root-about', 'about.html')
    const result = await resolveCleanUrl(app, 'about', '')
    expect(result).not.toBeNull()
    expect(result!.name).toBe('about.html')
  })
})

describe('resolveSpaFallback', () => {
  it('finds index.html in the route root', async () => {
    const dir = await app.service.directories.create('app')
    await createFile('spa1', 'index.html', dir.id)

    const result = await resolveSpaFallback(app, 'app/dashboard/settings', 'app')
    expect(result).not.toBeNull()
    expect(result!.file.name).toBe('index.html')
    expect(result!.dirPath).toBe('app')
  })

  it('finds index.html in intermediate directory', async () => {
    await app.service.directories.create('app')
    const sub = await app.service.directories.create('dashboard', 'app')
    await createFile('spa2', 'index.html', sub.id)

    const result = await resolveSpaFallback(app, 'app/dashboard/settings', 'app')
    expect(result).not.toBeNull()
    expect(result!.dirPath).toBe('app/dashboard')
  })

  it('does not cross route boundary', async () => {
    const root = await app.service.directories.create('app')
    await createFile('root-idx', 'index.html', root.id)
    await app.service.directories.create('sub', 'app')

    const result = await resolveSpaFallback(app, 'app/sub/page', 'app/sub')
    expect(result).toBeNull()
  })

  it('returns null when no index.html exists anywhere', async () => {
    await app.service.directories.create('site')
    const result = await resolveSpaFallback(app, 'site/page/sub', 'site')
    expect(result).toBeNull()
  })

  it('finds unfiled index.html at the empty route root', async () => {
    await createFile('root-idx', 'index.html')

    const result = await resolveSpaFallback(app, 'deep/route', '')
    expect(result).not.toBeNull()
    expect(result!.file.name).toBe('index.html')
    expect(result!.dirPath).toBe('')
  })
})
