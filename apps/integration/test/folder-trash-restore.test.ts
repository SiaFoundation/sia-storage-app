/**
 * Deleting a folder and restoring from the trash, across devices.
 *
 * Folders are not synced themselves. A device holds a folder because a live
 * file in it says so in its metadata. A trashed file names the folder it was
 * trashed from, which restore recreates, but it does not keep that folder in
 * the library on any device. So a deleted folder goes everywhere, never comes
 * back on its own, and comes back where it was when something in it is
 * restored, with its parents, in any order.
 */

import { decodeFileMetadata } from '@siastorage/core/encoding/fileMetadata'
import { directoryProviderId } from '@siastorage/core/types'
import { toContentHash } from '@siastorage/core/lib/contentHash'
import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import * as crypto from 'crypto'
import * as nodeFs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createTestApp, type TestApp, waitForCondition } from './app'
import { sleep } from './utils'

type Storage = ReturnType<typeof createEmptyIndexerStorage>

/** Long enough for ten sync passes, so a folder that was coming back would have. */
const QUIET_MS = 2_000

async function addFile(app: TestApp, id: string, name: string, folder?: string): Promise<void> {
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
  if (folder) {
    const dir = await app.app.directories.getOrCreateAtPath(folder)
    await app.moveFileToDirectory(id, dir.id)
  }
}

async function folders(app: TestApp): Promise<string[]> {
  return (await app.readAllDirectoriesWithCounts()).map((d) => d.path).sort()
}

async function folderId(app: TestApp, folderPath: string): Promise<string> {
  const dir = await app.app.directories.getByPath(folderPath)
  if (!dir) throw new Error(`No folder ${folderPath}`)
  return dir.id
}

/** What the indexer holds for a file, as another device would read it. */
function published(storage: Storage, fileId: string) {
  for (const obj of storage.objects.values()) {
    const meta = decodeFileMetadata(obj.metadata)
    if (meta.id === fileId) return meta
  }
  return null
}

async function trashed(app: TestApp, fileId: string): Promise<boolean> {
  return (await app.getFileById(fileId))?.trashedAt != null
}

async function live(app: TestApp, fileId: string): Promise<boolean> {
  const file = await app.getFileById(fileId)
  return file !== null && file.trashedAt === null && file.deletedAt === null
}

function waitFor(what: string, fn: () => Promise<boolean> | boolean): Promise<void> {
  return waitForCondition(fn, { timeout: 15_000, message: what })
}

describe('Deleting and restoring folders', () => {
  let storage: Storage
  let appA: TestApp
  let appB: TestApp
  const later: TestApp[] = []

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
    for (const app of later.splice(0)) await app.shutdown()
  })

  /** Trips holds a.txt, already in the trash, and b.txt, on both devices. */
  async function tripsWithATrashedFile(): Promise<void> {
    await addFile(appA, 'a', 'a.txt', 'Trips')
    await addFile(appA, 'b', 'b.txt', 'Trips')
    await appA.waitForNoActiveUploads()
    await waitFor('B has b.txt in Trips', async () => {
      return (await appB.readDirectoryPathForFile('b')) === 'Trips'
    })
    await appA.app.files.trashFile('a')
    await waitFor('B has a.txt in the trash', () => trashed(appB, 'a'))
  }

  async function deleteTripsOnA(): Promise<void> {
    await appA.app.directories.deleteAndTrashFiles(await folderId(appA, 'Trips'))
    await waitFor('B has b.txt in the trash', () => trashed(appB, 'b'))
  }

  it('a deleted folder disappears on the other device, though it held a file already in the trash', async () => {
    await tripsWithATrashedFile()

    await deleteTripsOnA()
    await sleep(QUIET_MS)

    expect(await folders(appA)).toEqual([])
    expect(await folders(appB)).toEqual([])
  }, 60_000)

  it('a device that signs in after the delete never sees the folder, and its trash lists it as one item', async () => {
    await tripsWithATrashedFile()
    await deleteTripsOnA()

    const appC = createTestApp(storage)
    later.push(appC)
    await appC.start()
    await waitFor('C has both files', async () => {
      return (await trashed(appC, 'a')) && (await trashed(appC, 'b'))
    })
    await sleep(QUIET_MS)

    expect(await folders(appC)).toEqual([])
    const entries = await appC.app.files.trashEntries()
    expect(entries.map((e) => [e.kind, e.name, e.folder, e.files]).sort()).toEqual([
      ['file', 'a.txt', 'Trips', 1],
      ['folder', 'Trips', null, 1],
    ])
  }, 60_000)

  it('a file trashed just before its folder is deleted does not bring the folder back when its own change syncs back', async () => {
    await addFile(appA, 'a', 'a.txt', 'Trips')
    await addFile(appA, 'b', 'b.txt', 'Trips')
    await appA.waitForNoActiveUploads()

    await appA.app.files.trashFile('a')
    // Deleted the moment the trash reaches the indexer, before A's sync-down
    // has read its own change back.
    await waitFor('the indexer has a.txt in the trash', () => {
      return published(storage, 'a')?.trashedAt != null
    })
    await appA.app.directories.deleteAndTrashFiles(await folderId(appA, 'Trips'))
    await waitFor('B has b.txt in the trash', () => trashed(appB, 'b'))
    await sleep(QUIET_MS)

    expect(await folders(appA)).toEqual([])
    expect(await folders(appB)).toEqual([])
    expect(published(storage, 'a')?.directory).toBe('Trips')
  }, 60_000)

  it('restoring a file on the other device puts it back in its folder, created again on both devices', async () => {
    await tripsWithATrashedFile()
    await deleteTripsOnA()

    await appB.app.files.restore(['a'])

    expect(await appB.readDirectoryPathForFile('a')).toBe('Trips')
    await waitFor('A has a.txt back in Trips', async () => {
      return (await live(appA, 'a')) && (await appA.readDirectoryPathForFile('a')) === 'Trips'
    })
    expect(await folders(appA)).toEqual(['Trips'])
    expect(await trashed(appA, 'b')).toBe(true)
  }, 60_000)

  it('restoring a deleted folder brings back its files and subfolders where they were, on both devices', async () => {
    await addFile(appA, 'top', 'top.txt', 'Photos/Trips')
    await addFile(appA, 'deep', 'deep.txt', 'Photos/Trips/2024/Rome')
    await addFile(appA, 'kept', 'kept.txt', 'Photos')
    await appA.waitForNoActiveUploads()
    await waitFor('B has every file', async () => {
      return (await appB.readDirectoryPathForFile('deep')) === 'Photos/Trips/2024/Rome'
    })

    await appA.app.directories.deleteAndTrashFiles(await folderId(appA, 'Photos/Trips'))
    await waitFor('B has both files in the trash', async () => {
      return (await trashed(appB, 'top')) && (await trashed(appB, 'deep'))
    })
    expect(await folders(appA)).toEqual(['Photos'])
    expect(await folders(appB)).toEqual(['Photos'])

    const [entry] = await appA.app.files.trashEntries()
    expect([entry.kind, entry.name, entry.folder, entry.files]).toEqual([
      'folder',
      'Trips',
      'Photos',
      2,
    ])
    await appA.app.files.restoreTrashEntries([entry.id])

    const tree = ['Photos', 'Photos/Trips', 'Photos/Trips/2024', 'Photos/Trips/2024/Rome']
    expect(await folders(appA)).toEqual(tree)
    await waitFor('B has both files back where they were', async () => {
      return (
        (await appB.readDirectoryPathForFile('top')) === 'Photos/Trips' &&
        (await appB.readDirectoryPathForFile('deep')) === 'Photos/Trips/2024/Rome'
      )
    })
    expect(await folders(appB)).toEqual(tree)
    expect(await appA.app.files.trashCount()).toBe(0)
  }, 60_000)

  it('two files of one name in a folder and its subfolder each come back to their own folder', async () => {
    await addFile(appA, 'n1', 'notes.txt', 'Trips')
    await addFile(appA, 'n2', 'notes.txt', 'Trips/sub')
    await appA.waitForNoActiveUploads()

    await appA.app.directories.deleteAndTrashFiles(await folderId(appA, 'Trips'))
    const [entry] = await appA.app.files.trashEntries()
    expect([entry.kind, entry.files, entry.versions]).toEqual(['folder', 2, 2])
    await appA.app.files.restoreTrashEntries([entry.id])

    expect(await appA.readDirectoryPathForFile('n1')).toBe('Trips')
    expect(await appA.readDirectoryPathForFile('n2')).toBe('Trips/sub')
    const inTrips = await appA.app.files.getVersionHistory(
      'notes.txt',
      await folderId(appA, 'Trips'),
    )
    expect(inTrips.map((v) => v.id)).toEqual(['n1'])
  }, 60_000)

  it.each([
    ['the nested file first', ['deep', 'top']],
    ['the top file first', ['top', 'deep']],
  ])(
    'restoring %s rebuilds the same tree',
    async (_, order) => {
      await addFile(appA, 'top', 'top.txt', 'Trips')
      await addFile(appA, 'deep', 'deep.txt', 'Trips/sub')
      await appA.waitForNoActiveUploads()
      await appA.app.directories.deleteAndTrashFiles(await folderId(appA, 'Trips'))
      expect(await folders(appA)).toEqual([])

      for (const id of order) await appA.app.files.restore([id])

      expect(await folders(appA)).toEqual(['Trips', 'Trips/sub'])
      expect(await appA.readDirectoryPathForFile('top')).toBe('Trips')
      expect(await appA.readDirectoryPathForFile('deep')).toBe('Trips/sub')
    },
    60_000,
  )

  it('a restore into a folder that exists again merges, renaming a file whose name is taken there', async () => {
    await addFile(appA, 'old', 'notes.txt', 'Trips')
    await addFile(appA, 'map', 'map.txt', 'Trips')
    await appA.waitForNoActiveUploads()
    await appA.app.directories.deleteAndTrashFiles(await folderId(appA, 'Trips'))
    await addFile(appA, 'new', 'notes.txt', 'Trips')

    const [entry] = (await appA.app.files.trashEntries()).filter((e) => e.kind === 'folder')
    const restored = await appA.app.files.restoreTrashEntries([entry.id])

    expect(restored.find((r) => r.id === 'old')).toEqual({
      id: 'old',
      name: 'notes (restored).txt',
      renamedFrom: 'notes.txt',
    })
    const tripsId = await folderId(appA, 'Trips')
    expect((await appA.app.files.getVersionHistory('notes.txt', tripsId)).map((v) => v.id)).toEqual(
      ['new'],
    )
    expect(await appA.readDirectoryPathForFile('map')).toBe('Trips')
    expect(await folders(appA)).toEqual(['Trips'])
  }, 60_000)

  it('a file whose folder was renamed after it was trashed restores to the old name', async () => {
    await addFile(appA, 'a', 'a.txt', 'Trips')
    await addFile(appA, 'b', 'b.txt', 'Trips')
    await appA.app.files.trashFile('a')
    await appA.renameDirectory(await folderId(appA, 'Trips'), 'Journeys')

    await appA.app.files.restore(['a'])

    expect(await appA.readDirectoryPathForFile('a')).toBe('Trips')
    expect(await folders(appA)).toEqual(['Journeys', 'Trips'])
  }, 60_000)

  it('trashing the last file in a folder removes the folder on both devices, and restoring it brings the folder back', async () => {
    await addFile(appA, 'a', 'a.txt', 'Trips')
    await appA.waitForNoActiveUploads()
    await waitFor('B has Trips', async () => (await folders(appB)).includes('Trips'))

    await appA.app.files.trashFile('a')

    expect(await folders(appA)).toEqual([])
    await waitFor('B has a.txt in the trash', () => trashed(appB, 'a'))
    expect(await folders(appB)).toEqual([])

    await appA.app.files.restore(['a'])
    await waitFor('B has a.txt back in Trips', async () => {
      return (await appB.readDirectoryPathForFile('a')) === 'Trips'
    })
    expect(await folders(appA)).toEqual(['Trips'])
  }, 60_000)

  it('a file deleted in the Finder folder leaves its folder on the Mac, so a file copied in after it lands there', async () => {
    const handoff = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'folder-trash-handoff-'))
    const mac = createTestApp(storage, { handoffDir: handoff })
    later.push(mac)
    await mac.start()
    let staged = 0
    const stage = (text: string) => {
      const file = path.join(handoff, `staged-${++staged}`)
      nodeFs.writeFileSync(file, text)
      return file
    }
    const docs = directoryProviderId((await mac.app.directories.create('Docs')).id)
    const a = await mac.app.provider.create(docs, 'a.txt', 'file', stage('a'))
    await mac.waitForNoActiveUploads()
    await waitFor('B has Docs', async () => (await folders(appB)).includes('Docs'))

    await mac.app.provider.trash(a.id)

    expect(await folders(mac)).toEqual(['Docs'])
    await waitFor('B drops Docs once a.txt is in the trash', async () => {
      return (await folders(appB)).length === 0
    })
    await mac.app.provider.create(docs, 'b.txt', 'file', stage('b'))
    expect((await mac.readAllDirectoriesWithCounts()).map((d) => [d.path, d.fileCount])).toEqual([
      ['Docs', 1],
    ])
    await mac.waitForNoActiveUploads()
    await waitFor('B has Docs again with b.txt', async () => (await folders(appB)).includes('Docs'))
  }, 60_000)

  it('a folder delete that fails partway leaves the folder and its files as they were', async () => {
    await addFile(appA, 'a', 'a.txt', 'Trips')
    await addFile(appA, 'b', 'b.txt', 'Trips/sub')
    await appA.waitForNoActiveUploads()
    const stopFailing = await appA.failInserts('feed_departures', 'disk full')

    const failure = await appA.app.directories
      .deleteAndTrashFiles(await folderId(appA, 'Trips'))
      .then(
        () => null,
        (e: { message?: string }) => e.message ?? String(e),
      )
    await stopFailing()

    expect(failure).toBe('disk full')
    expect(await folders(appA)).toEqual(['Trips', 'Trips/sub'])
    expect(await live(appA, 'a')).toBe(true)
    expect(await live(appA, 'b')).toBe(true)
    expect(await appA.app.files.trashCount()).toBe(0)
  }, 60_000)

  it('a file added on a device that had not seen the delete brings the folder back with only that file', async () => {
    await addFile(appA, 'a', 'a.txt', 'Trips')
    await appA.waitForNoActiveUploads()
    await waitFor('B has Trips', async () => (await folders(appB)).includes('Trips'))

    appB.setConnected(false)
    await appA.app.directories.deleteAndTrashFiles(await folderId(appA, 'Trips'))
    await addFile(appB, 'late', 'late.txt', 'Trips')
    appB.setConnected(true)

    await waitFor('A has late.txt in Trips', async () => {
      return (await appA.readDirectoryPathForFile('late')) === 'Trips'
    })
    await waitFor('B has a.txt in the trash', () => trashed(appB, 'a'))
    expect(await folders(appA)).toEqual(['Trips'])
    expect(await folders(appB)).toEqual(['Trips'])
    expect(await trashed(appA, 'a')).toBe(true)
  }, 60_000)

  it('emptying the trash after a folder delete leaves nothing of the folder on either device', async () => {
    await tripsWithATrashedFile()
    await deleteTripsOnA()

    expect(await appA.app.files.emptyTrash()).toBe(2)
    await waitFor('B has both files deleted for good', async () => {
      return (
        (await appB.getFileById('a'))?.deletedAt != null &&
        (await appB.getFileById('b'))?.deletedAt != null
      )
    })
    expect(await folders(appB)).toEqual([])
    expect(await appB.app.files.trashCount()).toBe(0)
  }, 60_000)
  it('moving a selection whose file was trashed since it was picked leaves a file of the same name at the top of the library in place', async () => {
    await addFile(appA, 'inTrips', 'notes.txt', 'Trips')
    await addFile(appA, 'atRoot', 'notes.txt')
    await appA.waitForNoActiveUploads()
    const docs = (await appA.createDirectory('Docs')).id
    await appA.app.files.trashFile('inTrips')

    await appA.app.files.moveFiles(['inTrips'], docs)

    expect(await appA.readDirectoryPathForFile('atRoot')).toBeUndefined()
    expect(await trashed(appA, 'inTrips')).toBe(true)
  }, 60_000)
})
