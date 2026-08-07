import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import { directoryProviderId, WORKING_SET_ID } from '@siastorage/core/types'
import { createTestApp, generateTestFiles, type TestApp } from './app'
import { createNewerVersion } from './utils'

describe('Provider changes', () => {
  let app: TestApp

  beforeEach(async () => {
    app = createTestApp(createEmptyIndexerStorage())
    await app.start()
  })

  afterEach(async () => {
    await app.shutdown()
  })

  describe('the anchor', () => {
    it('reports everything on a first pass from a zero anchor', async () => {
      await app.addFiles(generateTestFiles(2, { startId: 80 }))

      const changes = await app.app.provider.changes(null, '0')

      expect(changes.items).toHaveLength(2)
      expect(changes.anchor).not.toBe('0')
      expect(changes.hasMore).toBe(false)
    })

    it('re-reports the last millisecond rather than losing a write that lands in it', async () => {
      const [file] = await app.addFiles(generateTestFiles(1, { startId: 90 }))
      const first = await app.app.provider.changes(null, '0')

      const second = await app.app.provider.changes(null, first.anchor)

      expect(second.items.map((i) => i.id)).toEqual([file.id])
    })

    it('reports nothing once the clock has moved past the anchor', async () => {
      await app.addFiles(generateTestFiles(2, { startId: 95 }))
      const first = await app.app.provider.changes(null, '0')

      const later = `${Number(first.anchor.split(':')[0]) + 1}:`
      const second = await app.app.provider.changes(null, later)

      expect(second.items).toEqual([])
      expect(second.deletedIds).toEqual([])
    })

    it('keeps its place among rows written in the same millisecond', async () => {
      const paged = createTestApp(createEmptyIndexerStorage(), { maxPageSize: 2 })
      await paged.start()
      try {
        await paged.addFiles(generateTestFiles(5, { startId: 200 }))

        const seen: string[] = []
        let anchor = '0'
        let hasMore = true
        while (hasMore) {
          const page = await paged.app.provider.changes(null, anchor)
          seen.push(...page.items.map((i) => i.id))
          expect(page.anchor).not.toBe(anchor)
          anchor = page.anchor
          hasMore = page.hasMore
        }

        expect(new Set(seen).size).toBe(5)
      } finally {
        await paged.shutdown()
      }
    })

    it('says when a page was cut short', async () => {
      const paged = createTestApp(createEmptyIndexerStorage(), { maxPageSize: 2 })
      await paged.start()
      try {
        await paged.addFiles(generateTestFiles(4, { startId: 210 }))

        const page = await paged.app.provider.changes(null, '0')

        expect(page.items).toHaveLength(2)
        expect(page.hasMore).toBe(true)
      } finally {
        await paged.shutdown()
      }
    })

    it('reports only what changed after the anchor', async () => {
      const [existing] = await app.addFiles(generateTestFiles(1, { startId: 100 }))
      const first = await app.app.provider.changes(null, '0')

      await app.app.files.renameFile(existing.id, 'touched.bin')
      const second = await app.app.provider.changes(null, first.anchor)

      expect(second.items.map((i) => i.id)).toEqual([existing.id])
    })
  })

  describe('disappearances', () => {
    it('reports a trashed file as a deletion', async () => {
      const [file] = await app.addFiles(generateTestFiles(1, { startId: 110 }))
      const first = await app.app.provider.changes(null, '0')

      await app.app.files.trashFile(file.id)
      const second = await app.app.provider.changes(null, first.anchor)

      expect(second.deletedIds).toContain(file.id)
      expect(second.items.map((i) => i.id)).not.toContain(file.id)
    })

    it('reports a superseded version as gone in the page that adds its replacement', async () => {
      const [first] = await app.addFiles(generateTestFiles(1, { startId: 510 }))
      const anchor = (await app.app.provider.changes(null, '0')).anchor

      await createNewerVersion(app, first)
      const changes = await app.app.provider.changes(null, anchor)

      expect(changes.items.map((i) => i.id)).toContain('newer-version')
      expect(changes.deletedIds).toContain(first.id)
    })
  })

  describe('folders', () => {
    it('reports every subfolder, so a rename reaches the file browser', async () => {
      const dir = await app.app.directories.create('Docs')
      const first = await app.app.provider.changes(null, '0')
      expect(first.items.map((i) => i.id)).toContain(directoryProviderId(dir.id))

      await app.app.directories.rename(dir.id, 'Papers')
      const second = await app.app.provider.changes(null, first.anchor)

      const renamed = second.items.find((i) => i.id === directoryProviderId(dir.id))
      expect(renamed?.name).toBe('Papers')
    })

    it('asks for a fresh listing when a folder goes away', async () => {
      const dir = await app.app.directories.create('Docs')
      const first = await app.app.provider.changes(null, '0')
      expect(first.expired).toBe(false)

      await app.app.directories.deleteAndTrashFiles(dir.id)
      const second = await app.app.provider.changes(null, first.anchor)

      expect(second.expired).toBe(true)
      expect(second.items).toEqual([])
    })

    it('does not ask twice for the same disappearance', async () => {
      const dir = await app.app.directories.create('Docs')
      const first = await app.app.provider.changes(null, '0')
      await app.app.directories.deleteAndTrashFiles(dir.id)

      const second = await app.app.provider.changes(null, first.anchor)
      const third = await app.app.provider.changes(null, second.anchor)

      expect(third.expired).toBe(false)
    })

    it('leaves the listing out of it when only files change', async () => {
      await app.app.directories.create('Docs')
      const first = await app.app.provider.changes(null, '0')

      await app.addFiles(generateTestFiles(2, { startId: 600 }))
      const second = await app.app.provider.changes(null, first.anchor)

      expect(second.expired).toBe(false)
      expect(second.items.length).toBeGreaterThan(0)
    })

    it('leaves the listing out of it when a folder is renamed', async () => {
      const dir = await app.app.directories.create('Docs')
      const first = await app.app.provider.changes(null, '0')

      await app.app.directories.rename(dir.id, 'Papers')
      const second = await app.app.provider.changes(null, first.anchor)

      expect(second.expired).toBe(false)
      expect(second.items.find((i) => i.id === directoryProviderId(dir.id))?.name).toBe('Papers')
    })
  })

  describe('the working set', () => {
    it('reports a change made inside a folder', async () => {
      const dir = await app.app.directories.create('Docs')
      const [file] = await app.addFiles(generateTestFiles(1, { startId: 310 }))
      await app.app.directories.moveFile(file.id, dir.id)
      const anchor = (await app.app.provider.changes(WORKING_SET_ID, '0')).anchor

      await app.app.files.renameFile(file.id, 'renamed.bin')
      const changes = await app.app.provider.changes(WORKING_SET_ID, anchor)

      expect(changes.items.map((i) => i.id)).toContain(file.id)
    })

    it('carries the new parent when a file moves between folders', async () => {
      const from = await app.app.directories.create('From')
      const to = await app.app.directories.create('To')
      const [file] = await app.addFiles(generateTestFiles(1, { startId: 320 }))
      await app.app.directories.moveFile(file.id, from.id)
      const anchor = (await app.app.provider.changes(WORKING_SET_ID, '0')).anchor

      await app.app.directories.moveFile(file.id, to.id)
      const changes = await app.app.provider.changes(WORKING_SET_ID, anchor)

      expect(changes.items.find((i) => i.id === file.id)?.parentId).toBe(directoryProviderId(to.id))
    })

    it('reports a deletion made anywhere', async () => {
      const dir = await app.app.directories.create('Docs')
      const [file] = await app.addFiles(generateTestFiles(1, { startId: 330 }))
      await app.app.directories.moveFile(file.id, dir.id)
      const anchor = (await app.app.provider.changes(WORKING_SET_ID, '0')).anchor

      await app.app.files.trashFile(file.id)
      const changes = await app.app.provider.changes(WORKING_SET_ID, anchor)

      expect(changes.deletedIds).toContain(file.id)
    })

    it('reports a superseded version through it too', async () => {
      const [first] = await app.addFiles(generateTestFiles(1, { startId: 530 }))
      const anchor = (await app.app.provider.changes(WORKING_SET_ID, '0')).anchor

      await createNewerVersion(app, first)
      const changes = await app.app.provider.changes(WORKING_SET_ID, anchor)

      expect(changes.deletedIds).toContain(first.id)
    })

    it('never expires, because it lists no folders', async () => {
      const dir = await app.app.directories.create('Docs')
      const first = await app.app.provider.changes(WORKING_SET_ID, '0')

      await app.app.directories.deleteAndTrashFiles(dir.id)
      const second = await app.app.provider.changes(WORKING_SET_ID, first.anchor)

      expect(second.expired).toBe(false)
    })
  })
})
