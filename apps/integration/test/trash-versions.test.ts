/**
 * The trash and putting files back from it, when the file has several
 * versions and when its name has been used again since it was trashed, in
 * which case it comes back renamed.
 *
 * A file's versions share its name and folder, and the one with the newest
 * `updatedAt` is the one the library shows. Trashing and restoring have to
 * change `updatedAt` so other devices take the change, so these check that
 * they keep the versions in their order while doing it.
 */

import { toContentHash } from '@siastorage/core/lib/contentHash'
import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import * as crypto from 'crypto'
import * as nodeFs from 'fs'
import * as path from 'path'
import { createTestApp, type TestApp, waitForCondition } from './app'

async function addVersion(app: TestApp, id: string, name: string): Promise<void> {
  await app.addFiles([
    (tempDir) => {
      const content = crypto.randomBytes(1024)
      const filePath = path.join(tempDir, `${id}.txt`)
      nodeFs.writeFileSync(filePath, content)
      return {
        id,
        name,
        type: 'text/plain',
        size: content.length,
        hash: toContentHash(crypto.createHash('sha256').update(content).digest('hex')),
        uri: `file://${filePath}`,
      }
    },
  ])
}

/** The ids the library shows, one per file. */
async function shown(app: TestApp): Promise<string[]> {
  return (await app.app.files.query({ order: 'ASC' })).map((f) => f.id)
}

async function versionIds(app: TestApp, name: string): Promise<string[]> {
  return (await app.app.files.getVersionHistory(name, null)).map((v) => v.id)
}

describe('Restoring a file with versions', () => {
  let app: TestApp

  beforeEach(async () => {
    app = createTestApp(createEmptyIndexerStorage())
    await app.start()
  })

  afterEach(async () => {
    await app.shutdown()
  })

  // Ids that sort against the order the versions were saved in, since rows
  // given one shared updatedAt fall back to ordering by id.
  it('a file with three versions comes back with the same version current and the rest in order', async () => {
    for (const id of ['c-first', 'b-second', 'a-third']) {
      await addVersion(app, id, 'notes.txt')
      // Two saves in one millisecond share an updatedAt and order by id,
      // which would put these in the wrong order before the trash.
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(await versionIds(app, 'notes.txt')).toEqual(['a-third', 'b-second', 'c-first'])

    await app.app.files.trashFile('a-third')
    const [entry] = await app.app.files.trashEntries()
    await app.app.files.restoreTrashEntries([entry.id])

    expect(await versionIds(app, 'notes.txt')).toEqual(['a-third', 'b-second', 'c-first'])
    expect(await shown(app)).toEqual(['a-third'])
  })

  it('a file whose name was used again comes back renamed, leaving the newer file as it is', async () => {
    await addVersion(app, 'old', 'report.pdf')
    await app.app.files.trashFile('old')
    await addVersion(app, 'new', 'report.pdf')

    const [entry] = await app.app.files.trashEntries()
    const restored = await app.app.files.restoreTrashEntries([entry.id])

    expect(restored).toEqual([
      { id: 'old', name: 'report (restored).pdf', renamedFrom: 'report.pdf' },
    ])
    expect(await versionIds(app, 'report.pdf')).toEqual(['new'])
    expect(await versionIds(app, 'report (restored).pdf')).toEqual(['old'])
    expect((await shown(app)).sort()).toEqual(['new', 'old'])
  })

  it('two trashed files of a name now taken come back numbered, the earlier trash first', async () => {
    await addVersion(app, 'one', 'report.pdf')
    await app.app.files.trashFile('one')
    await addVersion(app, 'two', 'report.pdf')
    await app.app.files.trashFile('two')
    await addVersion(app, 'three', 'report.pdf')

    const entries = await app.app.files.trashEntries()
    const restored = await app.app.files.restoreTrashEntries(entries.map((e) => e.id))

    expect(restored.map((r) => [r.id, r.name])).toEqual([
      ['one', 'report (restored).pdf'],
      ['two', 'report (restored 2).pdf'],
    ])
    expect(await versionIds(app, 'report.pdf')).toEqual(['three'])
  })

  it('a file whose name is free again comes back under it', async () => {
    await addVersion(app, 'old', 'report.pdf')
    await app.app.files.trashFile('old')

    const [entry] = await app.app.files.trashEntries()
    const restored = await app.app.files.restoreTrashEntries([entry.id])

    expect(restored).toEqual([{ id: 'old', name: 'report.pdf', renamedFrom: null }])
  })

  it('deleting an entry restored since reports nothing deleted and leaves the file', async () => {
    await addVersion(app, 'back', 'report.pdf')
    await app.app.files.trashFile('back')
    await app.app.files.restoreTrashEntries(['back'])

    expect(await app.app.files.deleteTrashEntries(['back'])).toEqual([])
    expect((await app.app.files.getById('back'))?.deletedAt).toBeNull()
  })

  it('restoring a file deleted from the trash since leaves it deleted', async () => {
    await addVersion(app, 'gone', 'report.pdf')
    await app.app.files.trashFile('gone')
    await app.app.files.deleteTrashEntries(['gone'])

    await app.app.files.restore(['gone'])

    const row = await app.app.files.getById('gone')
    expect(row?.deletedAt).not.toBeNull()
    expect(row?.trashedAt).not.toBeNull()
  })
})

describe('Restoring on one device', () => {
  let storage: ReturnType<typeof createEmptyIndexerStorage>
  let appA: TestApp
  let appB: TestApp

  beforeEach(async () => {
    storage = createEmptyIndexerStorage()
    appA = createTestApp(storage)
    appB = createTestApp(storage)
    await appA.start()
    await appB.start()
  })

  afterEach(async () => {
    await appA.shutdown()
    await appB.shutdown()
  })

  it('the other device gets the file back with the same version current', async () => {
    await addVersion(appA, 'p-first', 'plan.txt')
    await appA.waitForNoActiveUploads()
    await addVersion(appA, 'n-second', 'plan.txt')
    await appA.waitForNoActiveUploads()
    await waitForCondition(async () => (await versionIds(appB, 'plan.txt')).length === 2, {
      timeout: 15_000,
      message: 'Device B has both versions',
    })

    await appA.app.files.trashFile('n-second')
    await waitForCondition(async () => (await versionIds(appB, 'plan.txt')).length === 0, {
      timeout: 15_000,
      message: 'Device B has the file in the trash',
    })

    const [entry] = await appA.app.files.trashEntries()
    await appA.app.files.restoreTrashEntries([entry.id])

    await waitForCondition(
      async () => (await versionIds(appB, 'plan.txt')).join() === ['n-second', 'p-first'].join(),
      { timeout: 15_000, message: 'Device B has both versions back, the second current' },
    )
  })
})

describe('The trash list', () => {
  let app: TestApp

  beforeEach(async () => {
    app = createTestApp(createEmptyIndexerStorage())
    await app.start()
  })

  afterEach(async () => {
    await app.shutdown()
  })

  it('lists one entry per file trashed, with its versions, newest trash first', async () => {
    await addVersion(app, 'a1', 'a.txt')
    await addVersion(app, 'a2', 'a.txt')
    await addVersion(app, 'b1', 'b.txt')
    const dir = await app.createDirectory('Trips')
    await app.moveFileToDirectory('b1', dir.id)

    await app.app.files.trashFile('a2')
    await app.app.files.trashFile('b1')

    const entries = await app.app.files.trashEntries()
    expect(entries.map((e) => [e.id, e.name, e.folder, e.versions])).toEqual([
      ['b1', 'b.txt', 'Trips', 1],
      ['a2', 'a.txt', null, 2],
    ])
    expect(await app.app.files.trashCount()).toBe(2)
    expect(entries[0].purgeAt).toBeGreaterThan(Date.now())
  })

  it('deleting an entry removes every version it holds, and emptying removes the rest', async () => {
    await addVersion(app, 'a1', 'a.txt')
    await addVersion(app, 'a2', 'a.txt')
    await addVersion(app, 'b1', 'b.txt')
    await app.app.files.trashFile('a2')
    await app.app.files.trashFile('b1')

    expect(await app.app.files.deleteTrashEntries(['a2'])).toEqual(['a2'])
    expect((await app.app.files.getById('a1'))?.deletedAt).not.toBeNull()
    expect((await app.app.files.trashEntries()).map((e) => e.id)).toEqual(['b1'])

    expect(await app.app.files.emptyTrash()).toBe(1)
    expect(await app.app.files.trashCount()).toBe(0)
  })
})
