import * as nodeFs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import { createTestApp, generateTestFiles, type TestApp } from './app'

describe('Provider handoff', () => {
  let app: TestApp
  let handoffDir: string

  beforeEach(async () => {
    handoffDir = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'provider-handoff-'))
    app = createTestApp(createEmptyIndexerStorage(), { handoffDir })
    await app.start()
  })

  afterEach(async () => {
    await app.shutdown()
    nodeFs.rmSync(handoffDir, { recursive: true, force: true })
  })

  const dest = (name: string) => path.join(handoffDir, name)

  describe('path containment', () => {
    it('refuses a destination outside the handoff directory', async () => {
      const [file] = await app.addFiles(generateTestFiles(1, { startId: 1 }))

      await expect(app.app.provider.fetch(file.id, '/tmp/escaped.bin')).rejects.toThrow(/outside/)
    })

    it('refuses a destination that climbs out with ..', async () => {
      const [file] = await app.addFiles(generateTestFiles(1, { startId: 2 }))

      await expect(
        app.app.provider.fetch(file.id, path.join(handoffDir, '..', 'escaped.bin')),
      ).rejects.toThrow(/outside/)
    })

    it('refuses a sibling directory sharing the handoff name prefix', async () => {
      const [file] = await app.addFiles(generateTestFiles(1, { startId: 3 }))

      await expect(app.app.provider.fetch(file.id, `${handoffDir}-evil/x.bin`)).rejects.toThrow(
        /outside/,
      )
    })

    it('refuses staged bytes that are a symlink out of the handoff directory', async () => {
      const secret = path.join(os.tmpdir(), `provider-secret-${process.pid}`)
      nodeFs.writeFileSync(secret, 'not yours')
      const staged = dest('link.bin')
      nodeFs.symlinkSync(secret, staged)

      try {
        await expect(app.app.provider.create(null, 'link.bin', 'file', staged)).rejects.toThrow(
          /symbolic link/,
        )
        expect(nodeFs.readFileSync(secret, 'utf8')).toBe('not yours')
      } finally {
        nodeFs.rmSync(secret, { force: true })
      }
    })

    it('accepts a nested path inside the handoff directory', async () => {
      const [file] = await app.addFiles(generateTestFiles(1, { startId: 4 }))
      nodeFs.mkdirSync(dest('fetch'), { recursive: true })

      const result = await app.app.provider.fetch(file.id, dest('fetch/out.bin'))

      expect(result.bytes).toBeGreaterThan(0)
    })
  })

  describe('fetch', () => {
    it('writes the file bytes to the destination', async () => {
      const [file] = await app.addFiles(generateTestFiles(1, { startId: 10 }))
      const target = dest('out.bin')

      const result = await app.app.provider.fetch(file.id, target)

      expect(nodeFs.existsSync(target)).toBe(true)
      expect(nodeFs.statSync(target).size).toBe(result.bytes)
      expect(result.item.id).toBe(file.id)
    })

    it('overwrites a stale file already at the destination', async () => {
      const [file] = await app.addFiles(generateTestFiles(1, { startId: 20 }))
      const target = dest('out.bin')
      nodeFs.writeFileSync(target, 'stale')

      const result = await app.app.provider.fetch(file.id, target)

      expect(nodeFs.statSync(target).size).toBe(result.bytes)
    })

    it('reports a missing file rather than writing an empty one', async () => {
      await expect(app.app.provider.fetch('no-such-file', dest('out.bin'))).rejects.toThrow(
        /no-such-file/,
      )
      expect(nodeFs.existsSync(dest('out.bin'))).toBe(false)
    })
  })

  describe('create', () => {
    it('creates a folder at the root', async () => {
      const item = await app.app.provider.create(null, 'Reports', 'dir')

      expect(item).toMatchObject({ kind: 'dir', name: 'Reports', parentId: null })
    })

    it('creates a folder inside another folder', async () => {
      const parent = await app.app.provider.create(null, 'Outer', 'dir')

      const child = await app.app.provider.create(parent.id, 'Inner', 'dir')

      expect(child.parentId).toBe(parent.id)
    })

    it('creates a file from staged bytes and takes ownership of them', async () => {
      const staged = dest('staged.txt')
      nodeFs.writeFileSync(staged, 'hello from finder')

      const item = await app.app.provider.create(null, 'note.txt', 'file', staged)

      expect(item).toMatchObject({ kind: 'file', name: 'note.txt', downloaded: true })
      expect(item.size).toBe('hello from finder'.length)
    })

    it('files a created file into its folder', async () => {
      const folder = await app.app.provider.create(null, 'Inbox', 'dir')
      const staged = dest('staged2.txt')
      nodeFs.writeFileSync(staged, 'x')

      const item = await app.app.provider.create(folder.id, 'in-folder.txt', 'file', staged)

      const page = await app.app.provider.list(folder.id)
      expect(page.items.map((i) => i.id)).toContain(item.id)
    })

    it('types a created file from its name, not the staged file', async () => {
      const staged = dest('anonymous-staged-blob')
      nodeFs.writeFileSync(staged, 'plain text')

      const item = await app.app.provider.create(null, 'notes.txt', 'file', staged)

      const record = await app.app.files.getById(item.id)
      expect(record?.type).toBe('text/plain')
    })

    it('refuses a file with no staged bytes', async () => {
      await expect(app.app.provider.create(null, 'empty.txt', 'file')).rejects.toThrow(/bytes/)
    })

    it('refuses staged bytes from outside the handoff directory', async () => {
      const outside = path.join(os.tmpdir(), 'outside-staged.txt')
      nodeFs.writeFileSync(outside, 'x')
      try {
        await expect(app.app.provider.create(null, 'nope.txt', 'file', outside)).rejects.toThrow(
          /outside/,
        )
      } finally {
        nodeFs.rmSync(outside, { force: true })
      }
    })
  })

  describe('write', () => {
    it('replaces a file\u2019s bytes and moves its content version', async () => {
      const staged = dest('v1.txt')
      nodeFs.writeFileSync(staged, 'first')
      const created = await app.app.provider.create(null, 'doc.txt', 'file', staged)

      const staged2 = dest('v2.txt')
      nodeFs.writeFileSync(staged2, 'second version, longer')
      const updated = await app.app.provider.write(created.id, staged2)

      expect(updated.size).toBe('second version, longer'.length)
      expect(updated.contentVersion).not.toBe(created.contentVersion)
    })
  })

  describe('rename', () => {
    it('renames a file in place', async () => {
      const [file] = await app.addFiles(generateTestFiles(1, { startId: 40 }))

      const item = await app.app.provider.rename(file.id, null, 'new-name.bin')

      expect(item).toMatchObject({ id: file.id, name: 'new-name.bin', parentId: null })
    })

    it('moves a file into a folder', async () => {
      const [file] = await app.addFiles(generateTestFiles(1, { startId: 50 }))
      const folder = await app.app.provider.create(null, 'Target', 'dir')

      const item = await app.app.provider.rename(file.id, folder.id, 'moved.bin')

      expect(item.parentId).toBe(folder.id)
      const page = await app.app.provider.list(folder.id)
      expect(page.items.map((i) => i.id)).toContain(file.id)
    })

    it('renames a folder and keeps its id', async () => {
      const folder = await app.app.provider.create(null, 'Before', 'dir')

      const item = await app.app.provider.rename(folder.id, null, 'After')

      expect(item.id).toBe(folder.id)
      expect(item.name).toBe('After')
    })

    it('keeps a folder’s children after it is renamed', async () => {
      const folder = await app.app.provider.create(null, 'Holder', 'dir')
      const staged = dest('child.txt')
      nodeFs.writeFileSync(staged, 'x')
      const child = await app.app.provider.create(folder.id, 'child.txt', 'file', staged)

      await app.app.provider.rename(folder.id, null, 'Renamed')

      const page = await app.app.provider.list(folder.id)
      expect(page.items.map((i) => i.id)).toContain(child.id)
    })
  })

  describe('trash', () => {
    it('removes a file from its listing', async () => {
      const [file] = await app.addFiles(generateTestFiles(1, { startId: 60 }))

      await app.app.provider.trash(file.id)

      const page = await app.app.provider.list(null)
      expect(page.items.map((i) => i.id)).not.toContain(file.id)
    })

    it('leaves a trashed file restorable rather than destroying it', async () => {
      const [file] = await app.addFiles(generateTestFiles(1, { startId: 70 }))

      await app.app.provider.trash(file.id)
      await app.app.files.restore([file.id])

      const page = await app.app.provider.list(null)
      expect(page.items.map((i) => i.id)).toContain(file.id)
    })

    it('trashes a folder along with the files inside it', async () => {
      const folder = await app.app.provider.create(null, 'Doomed', 'dir')
      const staged = dest('doomed.txt')
      nodeFs.writeFileSync(staged, 'x')
      const child = await app.app.provider.create(folder.id, 'doomed.txt', 'file', staged)

      await app.app.provider.trash(folder.id)

      expect(await app.app.provider.item(folder.id)).toBeNull()
      const restorable = await app.app.files.getById(child.id)
      expect(restorable?.trashedAt).not.toBeNull()
    })
  })

  describe('progress', () => {
    it('reports nothing in flight for an idle file', async () => {
      const [file] = await app.addFiles(generateTestFiles(1, { startId: 80 }))

      expect(await app.app.provider.progress(file.id)).toEqual({ received: 0, total: null })
    })
  })

  describe('without a handoff directory', () => {
    it('fails closed on every path call', async () => {
      const bare = createTestApp(createEmptyIndexerStorage())
      await bare.start()
      try {
        const [file] = await bare.addFiles(generateTestFiles(1, { startId: 90 }))
        await expect(bare.app.provider.fetch(file.id, '/tmp/x.bin')).rejects.toThrow(
          /No handoff directory/,
        )
      } finally {
        await bare.shutdown()
      }
    })
  })
})
