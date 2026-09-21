import * as nodeFs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import { fileURLToPath } from 'node:url'
import { createTestApp, generateTestFiles, waitForCondition, type TestApp } from './app'

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

    it('moves the edit clock, so the write outranks the state it replaced', async () => {
      const staged = dest('clock-v1.txt')
      nodeFs.writeFileSync(staged, 'first')
      const created = await app.app.provider.create(null, 'clock.txt', 'file', staged)
      // Backdated so a same-millisecond write cannot hide a preserved clock.
      await app.app.files.update({ id: created.id }, { updatedAt: 1000 })

      const staged2 = dest('clock-v2.txt')
      nodeFs.writeFileSync(staged2, 'replacement')
      const updated = await app.app.provider.write(created.id, staged2)

      expect(updated.modifiedAt).toBeGreaterThan(1000)

      // A row can carry another device's future wall clock via sync-down; the
      // write must outrank that too, not only the frozen-tie case.
      const future = Date.now() + 600_000
      await app.app.files.update({ id: created.id }, { updatedAt: future })
      const staged3 = dest('clock-v3.txt')
      nodeFs.writeFileSync(staged3, 'third bytes')
      const updated2 = await app.app.provider.write(created.id, staged3)
      expect(updated2.modifiedAt).toBeGreaterThan(future)
    })
  })

  describe('a local copy left short by an interrupted download', () => {
    /*
     * A download writes into the file it will finish as, so the file exists
     * from the first chunk. The system asks for the same item more than once
     * while one fetch is still running, and treating presence as completeness
     * hands the second caller the part written so far.
     */
    it('is re-fetched rather than served as the whole file', async () => {
      const [file] = await app.addFiles(generateTestFiles(1, { startId: 950, sizeBytes: 4096 }))
      await waitForCondition(() => app.getUploadState(file.id) !== undefined, {
        timeout: 10_000,
        message: 'the scanner to pick the file up',
      })
      await app.waitForNoActiveUploads()

      // Stands in for a download that stopped partway: the file exists and
      // is short.
      const local = fileURLToPath(app.app.fs.uri({ id: file.id, type: file.type }))
      nodeFs.writeFileSync(local, Buffer.alloc(1024))

      const result = await app.app.provider.fetch(file.id, dest('short-local.bin'))

      expect(result.bytes).toBe(4096)
      expect(nodeFs.statSync(dest('short-local.bin')).size).toBe(4096)
    })
  })

  describe('fetchRange', () => {
    /** An uploaded file, so a range has a remote object to read from, plus
     *  the bytes it was made of. */
    async function uploaded() {
      const [file] = await app.addFiles(generateTestFiles(1, { startId: 900, sizeBytes: 4096 }))
      await waitForCondition(() => app.getUploadState(file.id) !== undefined, {
        timeout: 10_000,
        message: 'the scanner to pick the file up',
      })
      await app.waitForNoActiveUploads()
      const uri = await app.app.fs.getFileUri({ id: file.id, type: file.type })
      if (!uri) throw new Error('the uploaded file has no local copy to compare against')
      return { file, contents: nodeFs.readFileSync(fileURLToPath(uri)) }
    }

    it('writes the requested bytes at their own offset in the file', async () => {
      const { file, contents } = await uploaded()

      const out = dest('range-out.bin')
      const result = await app.app.provider.fetchRange(file.id, out, 1024, 512)

      expect(result).toEqual({ offset: 1024, bytes: 512 })
      // The system reads an extent's position from where its bytes sit, so
      // the file runs to the end of the range with a hole in front of it.
      const written = nodeFs.readFileSync(out)
      expect(written.length).toBe(1536)
      expect(written.subarray(1024, 1536)).toEqual(contents.subarray(1024, 1536))
    })

    it('serves a range running past the end short rather than failing', async () => {
      const { file, contents } = await uploaded()

      const out = dest('short-out.bin')
      const result = await app.app.provider.fetchRange(file.id, out, 4000, 4096)

      // The shell rounds a request up to the system's alignment, so the last
      // range of a file routinely asks for more than is there.
      expect(result).toEqual({ offset: 4000, bytes: 96 })
      const written = nodeFs.readFileSync(out)
      expect(written.length).toBe(4096)
      expect(written.subarray(4000)).toEqual(contents.subarray(4000))
    })

    it('serves nothing for a range that starts past the end', async () => {
      const { file } = await uploaded()

      const result = await app.app.provider.fetchRange(file.id, dest('past-out.bin'), 9999, 10)

      expect(result).toEqual({ offset: 4096, bytes: 0 })
    })

    it('refuses a destination outside the handoff directory', async () => {
      const { file } = await uploaded()

      await expect(
        app.app.provider.fetchRange(file.id, '/tmp/not-the-handoff-dir.bin', 0, 4),
      ).rejects.toThrow()
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
