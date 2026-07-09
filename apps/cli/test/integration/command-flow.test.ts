import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { CliApp } from '../../src/app'
import { createTestApp } from '../helpers'

let tempDir: string

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-cmd-flow-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

async function createTestFile(app: CliApp, id: string, name: string) {
  const now = Date.now()
  await app.service.files.create({
    id,
    name,
    type: 'text/plain',
    kind: 'file',
    size: 100,
    hash: `hash-${id}`,
    createdAt: now,
    updatedAt: now,
    mediaAssetId: null,
    addedAt: now,
    trashedAt: null,
    deletedAt: null,
  })
}

describe('end-to-end command flows', () => {
  it('mkdir + ls: create directory shows in listing', async () => {
    const app = await createTestApp(tempDir)
    try {
      await app.service.directories.create('photos')
      const dirs = await app.service.directories.getAll()
      expect(dirs.some((d) => d.name === 'photos')).toBe(true)
    } finally {
      app.db.close?.()
    }
  })

  it('create file + ls: file shows in listing', async () => {
    const app = await createTestApp(tempDir)
    try {
      await createTestFile(app, 'f1', 'test.txt')
      const files = await app.service.files.query({ limit: 100, order: 'DESC' })
      expect(files.some((f) => f.name === 'test.txt')).toBe(true)
    } finally {
      app.db.close?.()
    }
  })

  it('create file + info: shows correct metadata', async () => {
    const app = await createTestApp(tempDir)
    try {
      await createTestFile(app, 'f1', 'important.doc')
      const file = await app.service.files.getById('f1')
      expect(file).not.toBeNull()
      expect(file!.name).toBe('important.doc')
      expect(file!.size).toBe(100)
    } finally {
      app.db.close?.()
    }
  })

  it('create file + rm: file is trashed', async () => {
    const app = await createTestApp(tempDir)
    try {
      await createTestFile(app, 'f1', 'deleteme.txt')
      await app.service.files.trashFile('f1')
      const file = await app.service.files.getById('f1')
      expect(file?.trashedAt).not.toBeNull()
    } finally {
      app.db.close?.()
    }
  })

  it('create file + tag + tags: tag appears in listing', async () => {
    const app = await createTestApp(tempDir)
    try {
      await createTestFile(app, 'f1', 'tagged.txt')
      await app.service.tags.add('f1', 'work')
      const tags = await app.service.tags.getAll()
      expect(tags.some((t) => t.name === 'work')).toBe(true)
    } finally {
      app.db.close?.()
    }
  })

  it('config: set and read back settings', async () => {
    const app = await createTestApp(tempDir)
    try {
      await app.service.settings.setIndexerURL('https://custom.sia')
      await app.service.settings.setHasOnboarded(true)
      expect(await app.service.settings.getIndexerURL()).toBe('https://custom.sia')
      expect(await app.service.settings.getHasOnboarded()).toBe(true)
    } finally {
      app.db.close?.()
    }
  })
})
