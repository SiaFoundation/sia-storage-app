import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createTestApp } from '../helpers'

let tempDir: string

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-cmd-mkdir-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('mkdir command logic', () => {
  it('creates directory with given name', async () => {
    const app = await createTestApp(tempDir)
    try {
      const dir = await app.service.directories.create('photos')
      expect(dir.name).toBe('photos')
      const all = await app.service.directories.getAll()
      expect(all.some((d: { name: string }) => d.name === 'photos')).toBe(true)
    } finally {
      app.db.close?.()
    }
  })

  it('creates multiple directories', async () => {
    const app = await createTestApp(tempDir)
    try {
      await app.service.directories.create('photos')
      await app.service.directories.create('documents')
      const all = await app.service.directories.getAll()
      expect(all.length).toBe(2)
    } finally {
      app.db.close?.()
    }
  })
})
