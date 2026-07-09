import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createTestApp } from '../helpers'

let tempDir: string

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-cmd-ls-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('ls command logic', () => {
  it('lists directories', async () => {
    const app = await createTestApp(tempDir)
    try {
      await app.service.directories.create('photos')
      await app.service.directories.create('documents')
      const dirs = await app.service.directories.getAll()
      expect(dirs.length).toBe(2)
      expect(dirs.map((d) => d.name).sort()).toEqual(['documents', 'photos'])
    } finally {
      app.db.close?.()
    }
  })

  it('lists files', async () => {
    const app = await createTestApp(tempDir)
    try {
      const now = Date.now()
      await app.service.files.create({
        id: 'f1',
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
      const files = await app.service.files.query({ limit: 100, order: 'DESC' })
      expect(files.length).toBe(1)
      expect(files[0].name).toBe('test.txt')
    } finally {
      app.db.close?.()
    }
  })

  it('shows empty state when no files', async () => {
    const app = await createTestApp(tempDir)
    try {
      const files = await app.service.files.query({ limit: 100, order: 'DESC' })
      expect(files.length).toBe(0)
    } finally {
      app.db.close?.()
    }
  })
})
