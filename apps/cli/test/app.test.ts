import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createTestApp } from './helpers'

let tempDir: string

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-cli-app-test-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('createCliAppService', () => {
  it('creates AppService and returns all required components', async () => {
    const app = await createTestApp(tempDir)
    expect(app.service).toBeDefined()
    expect(app.internal).toBeDefined()
    expect(app.uploadManager).toBeDefined()
    expect(app.db).toBeDefined()
    expect(app.paths).toBeDefined()
    expect(app.bootstrap).toBeDefined()
    app.db.close?.()
  })

  it('creates DB with WAL mode and runs migrations', async () => {
    const app = await createTestApp(tempDir)
    const result = await app.db.getFirstAsync<{ journal_mode: string }>('PRAGMA journal_mode')
    expect(result?.journal_mode).toBe('wal')

    const tables = await app.db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    )
    expect(tables.length).toBeGreaterThan(0)
    app.db.close?.()
  })

  it('creates storage files at correct paths', async () => {
    const app = await createTestApp(tempDir)
    await app.service.storage.setItem('test', 'value')
    expect(fs.existsSync(path.join(tempDir, 'storage.json'))).toBe(true)
    app.db.close?.()
  })

  it('can create and read back files', async () => {
    const app = await createTestApp(tempDir)
    const now = Date.now()
    await app.service.files.create({
      id: 'test-file',
      name: 'test.txt',
      type: 'text/plain',
      kind: 'file',
      size: 100,
      hash: 'abc123',
      createdAt: now,
      updatedAt: now,
      mediaAssetId: null,
      addedAt: now,
      trashedAt: null,
      deletedAt: null,
    })
    const file = await app.service.files.getById('test-file')
    expect(file).not.toBeNull()
    expect(file!.name).toBe('test.txt')
    app.db.close?.()
  })

  it('files directory is created', async () => {
    await createTestApp(tempDir)
    expect(fs.existsSync(path.join(tempDir, 'files'))).toBe(true)
  })
})
