import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import { directoryProviderId, WORKING_SET_ID } from '@siastorage/core/types'
import { createTestApp, generateTestFiles, type TestApp } from './app'
import { createNewerVersion } from './utils'

describe('Provider reads', () => {
  let app: TestApp

  beforeEach(async () => {
    app = createTestApp(createEmptyIndexerStorage())
    await app.start()
  })

  afterEach(async () => {
    await app.shutdown()
  })

  describe('list', () => {
    it('returns an empty root for an empty library', async () => {
      const page = await app.app.provider.list(null)

      expect(page.items).toEqual([])
      expect(page.cursor).toBeUndefined()
    })

    it('lists unfiled files at the root', async () => {
      await app.addFiles(generateTestFiles(3, { startId: 1 }))

      const page = await app.app.provider.list(null)

      expect(page.items).toHaveLength(3)
      expect(page.items.every((i) => i.kind === 'file')).toBe(true)
      expect(page.items.every((i) => i.parentId === null)).toBe(true)
    })

    it('lists a folder before the files beside it', async () => {
      await app.app.directories.create('Photos')
      await app.addFiles(generateTestFiles(1, { startId: 10 }))

      const page = await app.app.provider.list(null)

      expect(page.items[0]?.kind).toBe('dir')
      expect(page.items[0]?.name).toBe('Photos')
      expect(page.items[1]?.kind).toBe('file')
    })

    it('lists the files inside a folder', async () => {
      const dir = await app.app.directories.create('Docs')
      const files = await app.addFiles(generateTestFiles(2, { startId: 20 }))
      for (const f of files) await app.app.files.moveFile(f.id, dir.id)

      const page = await app.app.provider.list(directoryProviderId(dir.id))

      expect(page.items.map((i) => i.kind)).toEqual(['file', 'file'])
      expect(page.items.every((i) => i.parentId === directoryProviderId(dir.id))).toBe(true)
    })

    it('reports an empty listing for a folder that no longer exists', async () => {
      const dir = await app.app.directories.create('Gone')
      await app.app.directories.delete(dir.id)

      const page = await app.app.provider.list(directoryProviderId(dir.id))

      expect(page.items).toEqual([])
    })

    it('pages a listing longer than one page, without repeating a file', async () => {
      const paged = createTestApp(createEmptyIndexerStorage(), { maxPageSize: 2 })
      await paged.start()
      try {
        await paged.addFiles(generateTestFiles(5, { startId: 400 }))

        const seen: string[] = []
        let cursor: string | undefined
        do {
          const page = await paged.app.provider.list(null, cursor)
          seen.push(...page.items.map((i) => i.id))
          cursor = page.cursor
        } while (cursor)

        expect(new Set(seen).size).toBe(5)
      } finally {
        await paged.shutdown()
      }
    })

    it('reports an empty listing for an id that names nothing', async () => {
      const page = await app.app.provider.list(directoryProviderId('no-such-directory'))

      expect(page.items).toEqual([])
    })

    it('has no listing for the working set', async () => {
      await app.addFiles(generateTestFiles(2, { startId: 300 }))

      const page = await app.app.provider.list(WORKING_SET_ID)

      expect(page.items).toEqual([])
    })
  })

  describe('item', () => {
    it('returns a file by id', async () => {
      const [file] = await app.addFiles(generateTestFiles(1, { startId: 30 }))

      const item = await app.app.provider.item(file.id)

      expect(item).toMatchObject({ id: file.id, kind: 'file', parentId: null })
    })

    it('returns a folder by its provider id', async () => {
      const dir = await app.app.directories.create('Music')

      const item = await app.app.provider.item(directoryProviderId(dir.id))

      expect(item).toMatchObject({ kind: 'dir', name: 'Music', size: 0, parentId: null })
    })

    it('reports the parent of a nested folder', async () => {
      const parent = await app.app.directories.create('Top')
      const child = await app.app.directories.create('Inner', parent.path)

      const item = await app.app.provider.item(directoryProviderId(child.id))

      expect(item?.parentId).toBe(directoryProviderId(parent.id))
    })

    it('returns null for an id that names nothing', async () => {
      expect(await app.app.provider.item('nope')).toBeNull()
      expect(await app.app.provider.item(directoryProviderId('nope'))).toBeNull()
    })

    it('keeps a file id stable across a rename', async () => {
      const [file] = await app.addFiles(generateTestFiles(1, { startId: 40 }))

      await app.app.files.renameFile(file.id, 'renamed.bin')
      const item = await app.app.provider.item(file.id)

      expect(item?.id).toBe(file.id)
      expect(item?.name).toBe('renamed.bin')
    })

    it('keeps a folder id stable across a rename', async () => {
      const dir = await app.app.directories.create('Before')

      await app.app.directories.rename(dir.id, 'After')
      const item = await app.app.provider.item(directoryProviderId(dir.id))

      expect(item?.id).toBe(directoryProviderId(dir.id))
      expect(item?.name).toBe('After')
    })
  })

  describe('versions', () => {
    it('changes the metadata version on a rename but not the content version', async () => {
      const [file] = await app.addFiles(generateTestFiles(1, { startId: 50 }))
      const before = await app.app.provider.item(file.id)

      await app.app.files.renameFile(file.id, 'other-name.bin')
      const after = await app.app.provider.item(file.id)

      expect(after?.contentVersion).toBe(before?.contentVersion)
      expect(after?.metadataVersion).not.toBe(before?.metadataVersion)
    })

    it('lists the newest version and not the one behind it', async () => {
      const [first] = await app.addFiles(generateTestFiles(1, { startId: 500 }))
      await createNewerVersion(app, first)

      const page = await app.app.provider.list(null)

      expect(page.items.map((i) => i.id)).toEqual(['newer-version'])
    })

    it('stops answering for a superseded id', async () => {
      const [first] = await app.addFiles(generateTestFiles(1, { startId: 520 }))
      expect(await app.app.provider.item(first.id)).not.toBeNull()

      await createNewerVersion(app, first)

      expect(await app.app.provider.item(first.id)).toBeNull()
      expect(await app.app.provider.item('newer-version')).not.toBeNull()
    })
  })

  describe('badges', () => {
    it('reports a locally stored file as downloaded', async () => {
      const [file] = await app.addFiles(generateTestFiles(1, { startId: 60 }))

      const item = await app.app.provider.item(file.id)

      expect(item?.downloaded).toBe(true)
    })

    it('reports a file with no indexer object as not uploaded', async () => {
      app.setConnected(false)
      const [file] = await app.addFiles(generateTestFiles(1, { startId: 70 }))

      const item = await app.app.provider.item(file.id)

      expect(item?.uploaded).toBe(false)
    })

    it('reports a folder as carrying no transfer state', async () => {
      const dir = await app.app.directories.create('Empty')

      const item = await app.app.provider.item(directoryProviderId(dir.id))

      expect(item).toMatchObject({
        uploaded: true,
        uploading: false,
        downloaded: true,
        downloading: false,
        progress: 0,
      })
    })
  })
})
