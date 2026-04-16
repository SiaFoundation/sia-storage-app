import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createTestApp } from '../helpers'

let tempDir: string

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-cmd-search-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('search command logic', () => {
  it('finds files matching query', async () => {
    const app = await createTestApp(tempDir)
    try {
      const now = Date.now()
      await app.service.files.create({
        id: 'f1',
        name: 'vacation-photo.jpg',
        type: 'image/jpeg',
        kind: 'file',
        size: 1000,
        hash: 'abc',
        createdAt: now,
        updatedAt: now,
        localId: null,
        addedAt: now,
        trashedAt: null,
        deletedAt: null,
      })
      await app.service.files.create({
        id: 'f2',
        name: 'budget.xlsx',
        type: 'application/xlsx',
        kind: 'file',
        size: 500,
        hash: 'def',
        createdAt: now,
        updatedAt: now,
        localId: null,
        addedAt: now,
        trashedAt: null,
        deletedAt: null,
      })
      const allFiles = await app.service.files.query({ limit: 1000, order: 'DESC' })
      const results = allFiles.filter((f) => f.name.toLowerCase().includes('vacation'))
      expect(results.length).toBe(1)
      expect(results[0].name).toBe('vacation-photo.jpg')
    } finally {
      app.db.close?.()
    }
  })

  it('returns empty for no matches', async () => {
    const app = await createTestApp(tempDir)
    try {
      const allFiles = await app.service.files.query({ limit: 1000, order: 'DESC' })
      const results = allFiles.filter((f) => f.name.toLowerCase().includes('nonexistent'))
      expect(results.length).toBe(0)
    } finally {
      app.db.close?.()
    }
  })
})
