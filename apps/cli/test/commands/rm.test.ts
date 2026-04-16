import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { CliApp } from '../../src/app'
import { createTestApp } from '../helpers'

let tempDir: string

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-cmd-rm-'))
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
    localId: null,
    addedAt: now,
    trashedAt: null,
    deletedAt: null,
  })
  if (dirId) {
    await app.service.directories.moveFile(id, dirId)
  }
}

describe('rm command logic', () => {
  it('trashes file by default', async () => {
    const app = await createTestApp(tempDir)
    try {
      await createTestFile(app, 'file-1', 'test.txt')
      await app.service.files.trashFile('file-1')
      const file = await app.service.files.getById('file-1')
      expect(file?.trashedAt).not.toBeNull()
    } finally {
      app.db.close?.()
    }
  })

  it('tombstones file for permanent delete', async () => {
    const app = await createTestApp(tempDir)
    try {
      await createTestFile(app, 'file-1', 'test.txt')
      await app.service.files.tombstone(['file-1'])
      const file = await app.service.files.getById('file-1')
      expect(file?.deletedAt).not.toBeNull()
    } finally {
      app.db.close?.()
    }
  })

  it('recursively deletes a directory and trashes its files', async () => {
    const app = await createTestApp(tempDir)
    try {
      const dir = await app.service.directories.create('photos')
      await createTestFile(app, 'f1', 'a.txt', dir.id)
      await createTestFile(app, 'f2', 'b.txt', dir.id)

      const count = await app.service.directories.deleteAndTrashFiles(dir.id)
      expect(count).toBe(2)

      const f1 = await app.service.files.getById('f1')
      const f2 = await app.service.files.getById('f2')
      expect(f1?.trashedAt).not.toBeNull()
      expect(f2?.trashedAt).not.toBeNull()

      const deletedDir = await app.service.directories.getById(dir.id)
      expect(deletedDir).toBeNull()
    } finally {
      app.db.close?.()
    }
  })

  it('recursively deletes nested directories', async () => {
    const app = await createTestApp(tempDir)
    try {
      const parent = await app.service.directories.getOrCreateAtPath('docs/reports')
      await createTestFile(app, 'f1', 'report.txt', parent.id)

      const topDir = await app.service.directories.getByPath('docs')
      const count = await app.service.directories.deleteAndTrashFiles(topDir!.id)
      expect(count).toBe(1)

      const f1 = await app.service.files.getById('f1')
      expect(f1?.trashedAt).not.toBeNull()

      const docsDir = await app.service.directories.getByPath('docs')
      const reportsDir = await app.service.directories.getByPath('docs/reports')
      expect(docsDir).toBeNull()
      expect(reportsDir).toBeNull()
    } finally {
      app.db.close?.()
    }
  })
})
