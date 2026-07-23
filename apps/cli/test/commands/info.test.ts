import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createTestApp } from '../helpers'

let tempDir: string

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-cmd-info-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('info command logic', () => {
  it('retrieves file metadata by ID', async () => {
    const app = await createTestApp(tempDir)
    try {
      const now = Date.now()
      await app.service.files.create({
        id: 'file-1',
        name: 'test.txt',
        type: 'text/plain',
        kind: 'file',
        size: 42,
        hash: 'abc',
        createdAt: now,
        updatedAt: now,
        mediaAssetId: null,
        addedAt: now,
        trashedAt: null,
        deletedAt: null,
      })
      const file = await app.service.files.getById('file-1')
      expect(file).not.toBeNull()
      expect(file!.name).toBe('test.txt')
      expect(file!.size).toBe(42)
    } finally {
      app.db.close?.()
    }
  })

  it('retrieves tags for file', async () => {
    const app = await createTestApp(tempDir)
    try {
      const now = Date.now()
      await app.service.files.create({
        id: 'file-1',
        name: 'test.txt',
        type: 'text/plain',
        kind: 'file',
        size: 42,
        hash: 'abc',
        createdAt: now,
        updatedAt: now,
        mediaAssetId: null,
        addedAt: now,
        trashedAt: null,
        deletedAt: null,
      })
      await app.service.tags.add('file-1', 'important')
      const tags = await app.service.tags.getForFile('file-1')
      expect(tags.length).toBe(1)
      expect(tags[0].name).toBe('important')
    } finally {
      app.db.close?.()
    }
  })
})
