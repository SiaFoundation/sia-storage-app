import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createTestApp } from '../helpers'

let tempDir: string

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-cmd-config-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('config command logic', () => {
  it('reads default indexer URL', async () => {
    const app = await createTestApp(tempDir)
    try {
      const url = await app.service.settings.getIndexerURL()
      expect(typeof url).toBe('string')
      expect(url.length).toBeGreaterThan(0)
    } finally {
      app.db.close?.()
    }
  })

  it('sets and reads indexer URL', async () => {
    const app = await createTestApp(tempDir)
    try {
      await app.service.settings.setIndexerURL('https://custom.indexer')
      const url = await app.service.settings.getIndexerURL()
      expect(url).toBe('https://custom.indexer')
    } finally {
      app.db.close?.()
    }
  })

  it('reads onboarded state', async () => {
    const app = await createTestApp(tempDir)
    try {
      expect(await app.service.settings.getHasOnboarded()).toBe(false)
      await app.service.settings.setHasOnboarded(true)
      expect(await app.service.settings.getHasOnboarded()).toBe(true)
    } finally {
      app.db.close?.()
    }
  })
})
