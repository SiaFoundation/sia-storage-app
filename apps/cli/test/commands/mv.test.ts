import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { CliApp } from '../../src/app'
import { createTestApp } from '../helpers'

let tempDir: string

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-cmd-mv-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

async function createTestFile(app: CliApp, id: string, name: string, dirId?: string) {
  const now = Date.now()
  await app.service.files.create({
    id,
    name,
    type: 'text/plain',
    kind: 'file',
    size: 42,
    hash: 'abc-' + id,
    createdAt: now,
    updatedAt: now,
    mediaAssetId: null,
    addedAt: now,
    trashedAt: null,
    deletedAt: null,
  })
  if (dirId) {
    await app.service.directories.moveFile(id, dirId)
  }
}

describe('mv command logic', () => {
  it('moves a file into an existing directory', async () => {
    const app = await createTestApp(tempDir)
    try {
      await createTestFile(app, 'f1', 'photo.jpg')
      const dir = await app.service.directories.create('photos')

      await app.service.directories.moveFile('f1', dir.id)

      const filePath = await app.service.directories.getPathForFile('f1')
      expect(filePath).toBe('photos')
    } finally {
      app.db.close?.()
    }
  })

  it('renames a file', async () => {
    const app = await createTestApp(tempDir)
    try {
      await createTestFile(app, 'f1', 'old-name.txt')

      await app.service.files.renameFile('f1', 'new-name.txt')

      const file = await app.service.files.getById('f1')
      expect(file?.name).toBe('new-name.txt')
    } finally {
      app.db.close?.()
    }
  })

  it('moves a directory to a new parent', async () => {
    const app = await createTestApp(tempDir)
    try {
      const src = await app.service.directories.create('src')
      await createTestFile(app, 'f1', 'main.ts', src.id)
      await app.service.directories.create('projects')

      await app.service.directories.moveDirectory(src.id, 'projects')

      const moved = await app.service.directories.getByPath('projects/src')
      expect(moved).not.toBeNull()

      const filePath = await app.service.directories.getPathForFile('f1')
      expect(filePath).toBe('projects/src')
    } finally {
      app.db.close?.()
    }
  })

  it('renames a directory', async () => {
    const app = await createTestApp(tempDir)
    try {
      const dir = await app.service.directories.create('old-name')
      await createTestFile(app, 'f1', 'file.txt', dir.id)

      await app.service.directories.rename(dir.id, 'new-name')

      const renamed = await app.service.directories.getByPath('new-name')
      expect(renamed).not.toBeNull()

      const old = await app.service.directories.getByPath('old-name')
      expect(old).toBeNull()
    } finally {
      app.db.close?.()
    }
  })
})
