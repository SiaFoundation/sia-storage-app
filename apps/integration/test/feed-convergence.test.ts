/*
 * The invariant behind the provider feed: after any sequence of library
 * mutations, draining changes() from any anchor ever handed out converges a
 * mirror with what the library actually contains. Each test drives an
 * operation whose delivery is easy to get wrong: remote wall clocks,
 * promotions that move no clock, bulk moves, preserved-clock writes, and
 * the folder lifecycle.
 */
import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import { directoryProviderId, WORKING_SET_ID, type ProviderItem } from '@siastorage/core/types'
import { createTestApp, generateTestFiles, type TestApp } from './app'
import { createNewerVersion, drainListing } from './utils'

type Mirror = Map<string, ProviderItem>

async function fullyList(app: TestApp): Promise<{ mirror: Mirror; anchor: string }> {
  const listed = await drainListing(app, WORKING_SET_ID)
  return { mirror: new Map(listed.items.map((item) => [item.id, item])), anchor: listed.anchor }
}

async function drain(app: TestApp, mirror: Mirror, anchor: string): Promise<string> {
  for (;;) {
    const page = await app.app.provider.changes(WORKING_SET_ID, anchor)
    if (page.expired) throw new Error('the feed expired mid-drain')
    for (const item of page.items) mirror.set(item.id, item)
    for (const id of page.deletedIds) mirror.delete(id)
    anchor = page.anchor
    if (!page.hasMore) return anchor
  }
}

/** What the library actually contains, read outside the feed under test. */
async function truth(app: TestApp): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const dir of await app.app.directories.getAll()) {
    ids.add(directoryProviderId(dir.id))
  }
  const files = await app.app.files.queryLibrary({ limit: 100000 })
  for (const file of files) ids.add(file.id)
  return ids
}

async function expectConverged(app: TestApp, mirror: Mirror): Promise<void> {
  const expected = await truth(app)
  const mirrored = new Set(mirror.keys())
  expect([...mirrored].sort()).toEqual([...expected].sort())
}

describe('Feed convergence', () => {
  let app: TestApp
  let mirror: Mirror
  let anchor: string

  beforeEach(async () => {
    app = createTestApp(createEmptyIndexerStorage())
    await app.start()
    // Steps below run against a populated library: nested folders, filed
    // files, a version stack, and a trashed file, so each mutation lands
    // amid unrelated state.
    const docs = await app.app.directories.create('Documents')
    await app.app.directories.create('Archive', docs.path)
    const photos = await app.app.directories.create('Photos')
    await app.app.directories.create('2025', photos.path)
    const trips = await app.app.directories.create('Trips', `${photos.path}/2025`)
    const spread = await app.addFiles(generateTestFiles(12, { startId: 9000 }))
    await app.app.directories.moveFile(spread[0].id, docs.id)
    await app.app.directories.moveFile(spread[1].id, photos.id)
    await app.app.directories.moveFile(spread[2].id, trips.id)
    await createNewerVersion(app, spread[3], 'fixture-newer')
    await app.app.files.trashFile(spread[4].id)
    const listed = await fullyList(app)
    mirror = listed.mirror
    anchor = listed.anchor
    await expectConverged(app, mirror)
  })

  afterEach(async () => {
    await app.shutdown()
  })

  async function settle(): Promise<void> {
    anchor = await drain(app, mirror, anchor)
    await expectConverged(app, mirror)
  }

  it('a row whose domain timestamp is far in the past still converges', async () => {
    // Sync-down writes the other device's clock, so a clock-ordered cursor
    // would leave a row carrying an old wire stamp behind it forever. The
    // feed sequence is local apply order, so it cannot.
    const [file] = await app.addFiles(generateTestFiles(1, { startId: 9200 }))
    await settle()
    await app.app.files.update({ id: file.id, name: 'stamped-old.bin' }, { updatedAt: 1000 })
    await settle()
  })

  it('trash, restore, and tombstone each converge', async () => {
    const [file] = await app.addFiles(generateTestFiles(1, { startId: 9300 }))
    await settle()
    await app.app.files.trashFile(file.id)
    await settle()
    await app.app.files.restore([file.id])
    await settle()
    await app.app.files.tombstoneFile(file.id)
    await settle()
  })

  it('a superseded version and its later promotion both converge', async () => {
    const [first] = await app.addFiles(generateTestFiles(1, { startId: 9400 }))
    await createNewerVersion(app, first, 'promoted-newer')
    await settle()
    // Trash only the newer version, the per-id call, so the older one is
    // promoted back to current. The promotion writes no domain clock, so
    // only the `current` flip's own stamp can re-announce the promoted row.
    await app.app.files.trash(['promoted-newer'])
    await settle()
    expect([...mirror.keys()]).toContain(first.id)
  })

  it('stack rename and stack move converge', async () => {
    const [file] = await app.addFiles(generateTestFiles(1, { startId: 9500 }))
    await createNewerVersion(app, file, 'stacked-newer')
    await settle()
    await app.app.files.renameFile('stacked-newer', 'renamed.bin')
    await settle()
    const dir = await app.app.directories.create('Dest')
    await app.app.directories.moveFile('stacked-newer', dir.id)
    await settle()
  })

  it('a bulk move across stacks converges', async () => {
    // moveFiles stamps one decreasing updatedAt across every stack, which a
    // clock-ordered cursor would read as already delivered.
    const files = await app.addFiles(generateTestFiles(4, { startId: 9600 }))
    const dir = await app.app.directories.create('Bulk')
    await settle()
    await app.app.files.moveFiles(
      files.map((f) => f.id),
      dir.id,
    )
    await settle()
  })

  it('a preserve-stamp content write converges', async () => {
    const [file] = await app.addFiles(generateTestFiles(1, { startId: 9700 }))
    await settle()
    await app.app.files.update({ id: file.id, size: 12345 }, { updatedAt: 'preserve' })
    await settle()
  })

  it('folder create, rename with children, move, and delete converge', async () => {
    const parent = await app.app.directories.create('Feed')
    await app.app.directories.create('Inner', parent.path)
    await settle()
    await app.app.directories.rename(parent.id, 'FeedRenamed')
    await settle()
    const other = await app.app.directories.create('Elsewhere')
    await app.app.directories.moveDirectory(parent.id, other.path)
    await settle()
    await app.app.directories.deleteAndTrashFiles(parent.id)
    await settle()
  })

  it('empty-folder cleanup converges', async () => {
    const dir = await app.app.directories.create('Emptying')
    const [file] = await app.addFiles(generateTestFiles(1, { startId: 9800 }))
    await app.app.directories.moveFile(file.id, dir.id)
    await settle()
    await app.app.files.trashFile(file.id)
    await app.app.directories.deleteEmpty([dir.id])
    await settle()
  })

  it('churn under a tiny page size converges without loss or double-count', async () => {
    const paged = createTestApp(createEmptyIndexerStorage(), { maxPageSize: 2 })
    await paged.start()
    try {
      const listed = await fullyList(paged)
      let pagedAnchor = listed.anchor
      const pagedMirror = listed.mirror
      const dir = await paged.app.directories.create('Churn')
      const files = await paged.addFiles(generateTestFiles(7, { startId: 9900 }))
      for (const file of files.slice(0, 3)) {
        await paged.app.directories.moveFile(file.id, dir.id)
      }
      await paged.app.files.trashFile(files[3].id)
      await paged.app.directories.rename(dir.id, 'Churned')
      pagedAnchor = await drain(paged, pagedMirror, pagedAnchor)
      await expectConverged(paged, pagedMirror)
    } finally {
      await paged.shutdown()
    }
  })
})
