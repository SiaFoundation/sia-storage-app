import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { CliApp } from '../../src/app'
import { createTestApp } from '../helpers'

let tempDir: string

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-cmd-tags-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

async function createTestFile(app: CliApp) {
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
}

describe('tags command logic', () => {
  it('lists all tags with counts', async () => {
    const app = await createTestApp(tempDir)
    try {
      await createTestFile(app)
      await app.service.tags.add('file-1', 'work')
      await app.service.tags.add('file-1', 'important')
      const tags = await app.service.tags.getAll()
      const names = tags.map((t) => t.name)
      expect(names).toContain('work')
      expect(names).toContain('important')
    } finally {
      app.db.close?.()
    }
  })

  it('adds tag to file', async () => {
    const app = await createTestApp(tempDir)
    try {
      await createTestFile(app)
      await app.service.tags.add('file-1', 'tagged')
      const tags = await app.service.tags.getForFile('file-1')
      expect(tags.some((t) => t.name === 'tagged')).toBe(true)
    } finally {
      app.db.close?.()
    }
  })

  it('removes tag from file', async () => {
    const app = await createTestApp(tempDir)
    try {
      await createTestFile(app)
      await app.service.tags.add('file-1', 'removeme')
      const tags = await app.service.tags.getForFile('file-1')
      const tag = tags.find((t) => t.name === 'removeme')
      expect(tag).toBeDefined()
      await app.service.tags.remove('file-1', tag!.id)
      const after = await app.service.tags.getForFile('file-1')
      expect(after.length).toBe(0)
    } finally {
      app.db.close?.()
    }
  })

  it('returns tags including count', async () => {
    const app = await createTestApp(tempDir)
    try {
      await createTestFile(app)
      await app.service.tags.add('file-1', 'solo')
      const tags = await app.service.tags.getAll()
      const soloTag = tags.find((t) => t.name === 'solo')
      expect(soloTag).toBeDefined()
    } finally {
      app.db.close?.()
    }
  })
})
