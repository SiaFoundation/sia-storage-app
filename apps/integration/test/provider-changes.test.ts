import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import { directoryProviderId, WORKING_SET_ID } from '@siastorage/core/types'
import { createTestApp, generateTestFiles, type TestApp } from './app'
import { assertFeedConverges, drainListing, createNewerVersion } from './utils'

async function listedAnchor(target: TestApp, container: string | null): Promise<string> {
  return (await drainListing(target, container)).anchor
}

describe('Provider changes', () => {
  let app: TestApp

  beforeEach(async () => {
    app = createTestApp(createEmptyIndexerStorage())
    await app.start()
  })

  afterEach(async () => {
    await assertFeedConverges(app)
    await app.shutdown()
  })

  describe('the anchor', () => {
    it('an anchor from nowhere expires once, and the listing mints a real one', async () => {
      await app.addFiles(generateTestFiles(2, { startId: 80 }))

      const stray = await app.app.provider.changes(null, '0')
      expect(stray.expired).toBe(true)

      const anchor = await listedAnchor(app, null)
      const settled = await app.app.provider.changes(null, anchor)
      expect(settled.expired).toBe(false)
      expect(settled.items).toEqual([])
    })

    it("another library's anchor expires instead of stalling silently", async () => {
      const anchor = await listedAnchor(app, null)
      const foreign = `foreignepoch:${anchor.split(':').slice(1).join(':')}`

      const changes = await app.app.provider.changes(null, foreign)

      expect(changes.expired).toBe(true)
    })

    it('a file arriving during the listing is covered by the minted anchor', async () => {
      const paged = createTestApp(createEmptyIndexerStorage(), { maxPageSize: 2 })
      await paged.start()
      try {
        await paged.addFiles(generateTestFiles(3, { startId: 220 }))
        // First page read, then a file lands, then the drain finishes: the
        // anchor was captured when the listing began, so the late file is in
        // the first delta even though a page may also have carried it.
        let cursor: string | undefined
        const first = await paged.app.provider.list(null, cursor)
        cursor = first.cursor
        const [late] = await paged.addFiles(generateTestFiles(1, { startId: 225 }))
        let anchor: string | undefined
        while (anchor === undefined) {
          const page = await paged.app.provider.list(null, cursor)
          anchor = page.anchor
          cursor = page.cursor
        }

        const changes = await paged.app.provider.changes(null, anchor)
        expect(changes.items.map((i) => i.id)).toContain(late.id)
      } finally {
        await paged.shutdown()
      }
    })

    it('keeps its place across pages without losing or repeating a row', async () => {
      const paged = createTestApp(createEmptyIndexerStorage(), { maxPageSize: 2 })
      await paged.start()
      try {
        const anchor0 = await listedAnchor(paged, null)
        await paged.addFiles(generateTestFiles(5, { startId: 200 }))

        const seen: string[] = []
        let anchor = anchor0
        let hasMore = true
        while (hasMore) {
          const page = await paged.app.provider.changes(null, anchor)
          seen.push(...page.items.map((i) => i.id))
          expect(page.anchor).not.toBe(anchor)
          anchor = page.anchor
          hasMore = page.hasMore
        }

        expect(seen).toHaveLength(5)
        expect(new Set(seen).size).toBe(5)
      } finally {
        await paged.shutdown()
      }
    })

    it('says when a page was cut short', async () => {
      const paged = createTestApp(createEmptyIndexerStorage(), { maxPageSize: 2 })
      await paged.start()
      try {
        const anchor = await listedAnchor(paged, null)
        await paged.addFiles(generateTestFiles(4, { startId: 210 }))

        const page = await paged.app.provider.changes(null, anchor)

        expect(page.items).toHaveLength(2)
        expect(page.hasMore).toBe(true)
      } finally {
        await paged.shutdown()
      }
    })

    it('a drained working set answers empty polls with a stable anchor', async () => {
      await app.addFiles(generateTestFiles(1, { startId: 90 }))
      const drained = await listedAnchor(app, WORKING_SET_ID)

      const first = await app.app.provider.changes(WORKING_SET_ID, drained)
      const second = await app.app.provider.changes(WORKING_SET_ID, first.anchor)

      expect(first.items).toEqual([])
      expect(second.items).toEqual([])
      expect(second.expired).toBe(false)
      expect(second.anchor).toBe(first.anchor)
    })

    it('reports only what changed after the anchor', async () => {
      const [existing] = await app.addFiles(generateTestFiles(1, { startId: 100 }))
      const anchor = await listedAnchor(app, null)

      await app.app.files.renameFile(existing.id, 'touched.bin')
      const second = await app.app.provider.changes(null, anchor)

      expect(second.items.map((i) => i.id)).toEqual([existing.id])
    })
  })

  describe('disappearances', () => {
    it('reports a trashed file as a deletion', async () => {
      const [file] = await app.addFiles(generateTestFiles(1, { startId: 110 }))
      const anchor = await listedAnchor(app, null)

      await app.app.files.trashFile(file.id)
      const second = await app.app.provider.changes(null, anchor)

      expect(second.deletedIds).toContain(file.id)
      expect(second.items.map((i) => i.id)).not.toContain(file.id)
    })

    it('reports a superseded version as gone in the page that adds its replacement', async () => {
      const [first] = await app.addFiles(generateTestFiles(1, { startId: 510 }))
      const anchor = await listedAnchor(app, null)

      await createNewerVersion(app, first)
      const changes = await app.app.provider.changes(null, anchor)

      expect(changes.items.map((i) => i.id)).toContain('newer-version')
      expect(changes.deletedIds).toContain(first.id)
    })
  })

  describe('folders', () => {
    it('reports every subfolder, so a rename reaches the file browser', async () => {
      const dir = await app.app.directories.create('Docs')
      const anchor = await listedAnchor(app, null)

      await app.app.directories.rename(dir.id, 'Papers')
      const second = await app.app.provider.changes(null, anchor)

      const renamed = second.items.find((i) => i.id === directoryProviderId(dir.id))
      expect(renamed?.name).toBe('Papers')
      expect(second.expired).toBe(false)
    })

    it('a deleted subfolder arrives as a deletion, not a relist', async () => {
      const dir = await app.app.directories.create('Docs')
      const anchor = await listedAnchor(app, null)

      await app.app.directories.deleteAndTrashFiles(dir.id)
      const second = await app.app.provider.changes(null, anchor)

      expect(second.expired).toBe(false)
      expect(second.deletedIds).toContain(directoryProviderId(dir.id))
    })

    it('does not report the same disappearance on the next poll', async () => {
      const dir = await app.app.directories.create('Docs')
      const anchor = await listedAnchor(app, null)
      await app.app.directories.deleteAndTrashFiles(dir.id)

      const second = await app.app.provider.changes(null, anchor)
      const third = await app.app.provider.changes(null, second.anchor)

      expect(third.expired).toBe(false)
      expect(third.deletedIds).toEqual([])
    })

    it('the old folder reports a moved-away file as an update, not a deletion', async () => {
      const dir = await app.app.directories.create('Docs')
      const [file] = await app.addFiles(generateTestFiles(1, { startId: 640 }))
      const anchor = await listedAnchor(app, null)

      await app.app.directories.moveFile(file.id, dir.id)
      const second = await app.app.provider.changes(null, anchor)

      const moved = second.items.find((i) => i.id === file.id)
      expect(moved?.parentId).toBe(directoryProviderId(dir.id))
      expect(second.deletedIds).not.toContain(file.id)
    })

    it('a move that ends in a tombstone reports a deletion after all', async () => {
      const dir = await app.app.directories.create('Docs')
      const [file] = await app.addFiles(generateTestFiles(1, { startId: 650 }))
      const anchor = await listedAnchor(app, null)

      await app.app.directories.moveFile(file.id, dir.id)
      await app.app.files.tombstoneFile(file.id)
      const second = await app.app.provider.changes(null, anchor)

      expect(second.deletedIds).toContain(file.id)
      expect(second.items.map((i) => i.id)).not.toContain(file.id)
    })

    it('the old folder reports a moved-away subfolder as an update, not a deletion', async () => {
      const from = await app.app.directories.create('From')
      const to = await app.app.directories.create('To')
      const child = await app.app.directories.create('Child', from.path)
      const scope = directoryProviderId(from.id)
      const anchor = await listedAnchor(app, scope)

      await app.app.directories.moveDirectory(child.id, to.path)
      const second = await app.app.provider.changes(scope, anchor)

      const moved = second.items.find((i) => i.id === directoryProviderId(child.id))
      expect(moved?.parentId).toBe(directoryProviderId(to.id))
      expect(second.deletedIds).not.toContain(directoryProviderId(child.id))
    })

    it('a poll with nothing to report still advances the anchor', async () => {
      const dir = await app.app.directories.create('Docs')
      const scope = directoryProviderId(dir.id)
      const anchor = await listedAnchor(app, scope)

      await app.addFiles(generateTestFiles(1, { startId: 660 }))
      const second = await app.app.provider.changes(scope, anchor)

      expect(second.items).toEqual([])
      expect(second.deletedIds).toEqual([])
      expect(second.expired).toBe(false)
      expect(second.anchor).not.toBe(anchor)

      const third = await app.app.provider.changes(scope, second.anchor)
      expect(third.expired).toBe(false)
      expect(third.items).toEqual([])
    })

    it('a file created inside a folder journals nothing at the root scope', async () => {
      const handoffDir = mkdtempSync(path.join(tmpdir(), 'handoff-'))
      const host = createTestApp(createEmptyIndexerStorage(), { handoffDir })
      await host.start()
      try {
        const dir = await host.app.directories.create('Docs')
        const rootAnchor = await listedAnchor(host, null)

        const src = path.join(handoffDir, 'staged')
        writeFileSync(src, 'bytes')
        const created = await host.app.provider.create(
          directoryProviderId(dir.id),
          'note.txt',
          'file',
          src,
        )
        expect(created.parentId).toBe(directoryProviderId(dir.id))

        // Created already filed: the root scope has nothing to say about it,
        // as an item or as a removal.
        const second = await host.app.provider.changes(null, rootAnchor)
        expect(second.items.map((i) => i.id)).not.toContain(created.id)
        expect(second.deletedIds).not.toContain(created.id)
      } finally {
        await host.shutdown()
      }
    })

    it('a folder listing pages by name without losing or repeating a file', async () => {
      const paged = createTestApp(createEmptyIndexerStorage(), { maxPageSize: 2 })
      await paged.start()
      try {
        const dir = await paged.app.directories.create('Big')
        const files = await paged.addFiles(generateTestFiles(5, { startId: 670 }))
        for (const file of files) {
          await paged.app.directories.moveFile(file.id, dir.id)
        }
        const listed = await drainListing(paged, directoryProviderId(dir.id))
        const fileIds = listed.items.filter((i) => i.kind === 'file').map((i) => i.id)
        expect([...fileIds].sort()).toEqual(files.map((f) => f.id).sort())
        expect(new Set(fileIds).size).toBe(fileIds.length)
      } finally {
        await paged.shutdown()
      }
    })

    it('leaves the listing out of it when only files change', async () => {
      await app.app.directories.create('Docs')
      const anchor = await listedAnchor(app, null)

      await app.addFiles(generateTestFiles(2, { startId: 600 }))
      const second = await app.app.provider.changes(null, anchor)

      expect(second.expired).toBe(false)
      expect(second.items.length).toBeGreaterThan(0)
    })
  })

  describe('the working set', () => {
    it('reports a change made inside a folder', async () => {
      const dir = await app.app.directories.create('Docs')
      const [file] = await app.addFiles(generateTestFiles(1, { startId: 310 }))
      await app.app.directories.moveFile(file.id, dir.id)
      const anchor = await listedAnchor(app, WORKING_SET_ID)

      await app.app.files.renameFile(file.id, 'renamed.bin')
      const changes = await app.app.provider.changes(WORKING_SET_ID, anchor)

      expect(changes.items.map((i) => i.id)).toContain(file.id)
    })

    it('carries the new parent when a file moves between folders', async () => {
      const from = await app.app.directories.create('From')
      const to = await app.app.directories.create('To')
      const [file] = await app.addFiles(generateTestFiles(1, { startId: 320 }))
      await app.app.directories.moveFile(file.id, from.id)
      const anchor = await listedAnchor(app, WORKING_SET_ID)

      await app.app.directories.moveFile(file.id, to.id)
      const changes = await app.app.provider.changes(WORKING_SET_ID, anchor)

      expect(changes.items.find((i) => i.id === file.id)?.parentId).toBe(directoryProviderId(to.id))
    })

    it('reports a deletion made anywhere', async () => {
      const dir = await app.app.directories.create('Docs')
      const [file] = await app.addFiles(generateTestFiles(1, { startId: 330 }))
      await app.app.directories.moveFile(file.id, dir.id)
      const anchor = await listedAnchor(app, WORKING_SET_ID)

      await app.app.files.trashFile(file.id)
      const changes = await app.app.provider.changes(WORKING_SET_ID, anchor)

      expect(changes.deletedIds).toContain(file.id)
    })

    it('reports a superseded version through it too', async () => {
      const [first] = await app.addFiles(generateTestFiles(1, { startId: 530 }))
      const anchor = await listedAnchor(app, WORKING_SET_ID)

      await createNewerVersion(app, first)
      const changes = await app.app.provider.changes(WORKING_SET_ID, anchor)

      expect(changes.deletedIds).toContain(first.id)
    })

    it('reports a deleted folder as a deletion, with no relist', async () => {
      const dir = await app.app.directories.create('Docs')
      const anchor = await listedAnchor(app, WORKING_SET_ID)

      await app.app.directories.deleteAndTrashFiles(dir.id)
      const second = await app.app.provider.changes(WORKING_SET_ID, anchor)

      expect(second.expired).toBe(false)
      expect(second.deletedIds).toContain(directoryProviderId(dir.id))
    })

    it('reports a renamed folder as one updated item', async () => {
      const dir = await app.app.directories.create('Docs')
      const anchor = await listedAnchor(app, WORKING_SET_ID)

      await app.app.directories.rename(dir.id, 'Papers')
      const second = await app.app.provider.changes(WORKING_SET_ID, anchor)

      expect(second.expired).toBe(false)
      const renamed = second.items.find((i) => i.id === directoryProviderId(dir.id))
      expect(renamed?.name).toBe('Papers')
      expect(second.items.filter((i) => i.kind === 'dir')).toHaveLength(1)
    })

    it('does not report the same disappearance twice', async () => {
      const dir = await app.app.directories.create('Docs')
      const anchor = await listedAnchor(app, WORKING_SET_ID)
      await app.app.directories.deleteAndTrashFiles(dir.id)

      const second = await app.app.provider.changes(WORKING_SET_ID, anchor)
      const third = await app.app.provider.changes(WORKING_SET_ID, second.anchor)

      expect(third.deletedIds).toEqual([])
      expect(third.items).toEqual([])
    })

    it('hands the listing an anchor whose first delta carries the next folder', async () => {
      await app.app.directories.create('Docs')
      const anchor = await listedAnchor(app, WORKING_SET_ID)

      const before = await app.app.provider.changes(WORKING_SET_ID, anchor)
      expect(before.expired).toBe(false)

      const created = await app.app.directories.create('Papers')
      const after = await app.app.provider.changes(WORKING_SET_ID, anchor)
      expect(after.expired).toBe(false)
      expect(after.items.map((i) => i.id)).toContain(directoryProviderId(created.id))
    })

    it('a folder delete and recreate arrive as a removal then a fresh item', async () => {
      const dir = await app.app.directories.create('Docs')
      const anchor = await listedAnchor(app, WORKING_SET_ID)

      await app.app.directories.deleteAndTrashFiles(dir.id)
      const recreated = await app.app.directories.create('Docs')
      const changes = await app.app.provider.changes(WORKING_SET_ID, anchor)

      expect(changes.deletedIds).toContain(directoryProviderId(dir.id))
      expect(changes.items.map((i) => i.id)).toContain(directoryProviderId(recreated.id))
      expect(recreated.id).not.toBe(dir.id)
    })

    it('delivers a folder before the files created inside it', async () => {
      const anchor = await listedAnchor(app, WORKING_SET_ID)

      const dir = await app.app.directories.create('Fresh')
      const [file] = await app.addFiles(generateTestFiles(1, { startId: 620 }))
      await app.app.directories.moveFile(file.id, dir.id)
      const changes = await app.app.provider.changes(WORKING_SET_ID, anchor)

      const ids = changes.items.map((i) => i.id)
      expect(ids).toContain(directoryProviderId(dir.id))
      expect(ids).toContain(file.id)
      expect(ids.indexOf(directoryProviderId(dir.id))).toBeLessThan(ids.indexOf(file.id))
    })

    it('a new deep folder tree never pages a child ahead of an unmet parent', async () => {
      const paged = createTestApp(createEmptyIndexerStorage(), { maxPageSize: 2 })
      await paged.start()
      try {
        const listed = await drainListing(paged, WORKING_SET_ID)
        const known = new Set(listed.items.map((i) => i.id))

        await paged.app.directories.getOrCreateAtPath('Deep/One/Two/Three')

        let anchor = listed.anchor
        const dirNames: string[] = []
        for (;;) {
          const page = await paged.app.provider.changes(WORKING_SET_ID, anchor)
          for (const item of page.items) {
            if (item.parentId !== null) expect(known.has(item.parentId)).toBe(true)
            known.add(item.id)
            if (item.kind === 'dir') dirNames.push(item.name)
          }
          anchor = page.anchor
          if (!page.hasMore) break
        }
        expect(dirNames).toEqual(['Deep', 'One', 'Two', 'Three'])
      } finally {
        await paged.shutdown()
      }
    })

    it('reports only file items when only files change', async () => {
      await app.app.directories.create('Docs')
      const anchor = await listedAnchor(app, WORKING_SET_ID)

      await app.addFiles(generateTestFiles(2, { startId: 610 }))
      const second = await app.app.provider.changes(WORKING_SET_ID, anchor)

      expect(second.expired).toBe(false)
      expect(second.items.length).toBeGreaterThan(0)
      expect(second.items.every((i) => i.kind === 'file')).toBe(true)
    })
  })
})
