/**
 * Edits that change a file's tags, its folder's name or its folder's place,
 * when the file has an older version saved under the same name. The version
 * with the newest `updatedAt` is the one the library shows, and every edit
 * has to move `updatedAt` forward for other devices to take it, so these
 * check that an edit reaching an older version leaves the newest one current
 * on both devices, and that it leaves alone a newer version another device
 * edited in the meantime.
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
  return (await app.app.files.query({ order: 'ASC' })).map((f) => f.id).sort()
}

async function versionIds(app: TestApp, name: string, folder?: string): Promise<string[]> {
  const dir = folder === undefined ? null : await app.app.directories.getByPath(folder)
  if (folder !== undefined && !dir) return []
  return (await app.app.files.getVersionHistory(name, dir?.id ?? null)).map((v) => v.id)
}

async function tagNames(app: TestApp, fileId: string): Promise<string[]> {
  return (await app.readTagsForFile(fileId)).map((t) => t.name)
}

describe('Edits on a file with an older version', () => {
  let appA: TestApp
  let appB: TestApp

  beforeEach(async () => {
    const shared = createEmptyIndexerStorage()
    appA = createTestApp(shared)
    appB = createTestApp(shared)
    await appA.start()
    await appB.start()
  })

  afterEach(async () => {
    await appA.shutdown()
    await appB.shutdown()
  })

  // Ids sort against the save order, so if the versions ever tied on
  // updatedAt the older one would win and the test would see it.
  async function saveTwoVersions(name: string): Promise<void> {
    await addVersion(appA, 'b-v1', name)
    // Uploaded before v2 replaces it, since the uploader skips a version that
    // is no longer current, and B would then never get v1.
    await appA.waitForNoActiveUploads()
    await addVersion(appA, 'a-v2', name)
    await appA.waitForNoActiveUploads()
    for (const app of [appA, appB]) {
      await waitForCondition(async () => (await versionIds(app, name)).length === 2, {
        timeout: 15_000,
        message: 'both versions on the device',
      })
      expect(await versionIds(app, name)).toEqual(['a-v2', 'b-v1'])
    }
  }

  it('renaming or deleting a tag the older version carries leaves the newer version current on both devices', async () => {
    await addVersion(appA, 'b-v1', 'notes.txt')
    await appA.addTagToFile('b-v1', 'trip')
    await appA.waitForNoActiveUploads()
    await addVersion(appA, 'a-v2', 'notes.txt')
    await appA.waitForNoActiveUploads()
    await waitForCondition(
      async () =>
        (await versionIds(appB, 'notes.txt')).length === 2 &&
        (await tagNames(appB, 'b-v1')).includes('trip'),
      { timeout: 15_000, message: 'device B has both versions and the tag' },
    )
    expect(await shown(appB)).toEqual(['a-v2'])

    const trip = (await appA.readAllTagsWithCounts()).find((t) => t.name === 'trip')!
    await appA.renameTag(trip.id, 'holiday')

    expect(await shown(appA)).toEqual(['a-v2'])
    await waitForCondition(async () => (await tagNames(appB, 'b-v1')).includes('holiday'), {
      timeout: 15_000,
      message: 'the renamed tag reaches device B',
    })
    for (const app of [appA, appB]) {
      expect(await versionIds(app, 'notes.txt')).toEqual(['a-v2', 'b-v1'])
      expect(await shown(app)).toEqual(['a-v2'])
    }

    const holiday = (await appA.readAllTagsWithCounts()).find((t) => t.name === 'holiday')!
    await appA.app.tags.delete(holiday.id)

    expect(await shown(appA)).toEqual(['a-v2'])
    await waitForCondition(async () => (await tagNames(appB, 'b-v1')).length === 0, {
      timeout: 15_000,
      message: 'the deleted tag leaves the older version on device B',
    })
    for (const app of [appA, appB]) {
      expect(await versionIds(app, 'notes.txt')).toEqual(['a-v2', 'b-v1'])
      expect(await shown(app)).toEqual(['a-v2'])
    }
  }, 60_000)

  it('favoriting an older version keeps a tag another device gave the newer version meanwhile', async () => {
    await saveTwoVersions('notes.txt')

    // A is offline, so it favorites the older version without having seen
    // B's tag, and its favorite is the later of the two edits.
    appA.pause()
    await appB.addTagToFile('a-v2', 'trip')
    await new Promise((r) => setTimeout(r, 10))
    await appA.app.tags.toggleFavorite('b-v1')
    appA.resume()

    for (const app of [appA, appB]) {
      await waitForCondition(
        async () =>
          (await tagNames(app, 'a-v2')).includes('trip') && (await app.app.tags.isFavorite('b-v1')),
        { timeout: 15_000, message: "the device has B's tag and A's favorite" },
      )
      expect(await versionIds(app, 'notes.txt')).toEqual(['a-v2', 'b-v1'])
      expect(await shown(app)).toEqual(['a-v2'])
    }
  }, 60_000)

  it('renaming a file refreshes the cached row of every version it renames', async () => {
    await saveTwoVersions('draft.txt')
    const refreshed = jest.spyOn(appA.app.caches.fileById, 'invalidate')

    await appA.app.files.renameFile('a-v2', 'final.txt')

    expect(refreshed).toHaveBeenCalledWith('a-v2')
    expect(refreshed).toHaveBeenCalledWith('b-v1')
  }, 60_000)
})

describe('Renaming or moving the folder of a file with an older version', () => {
  let appA: TestApp
  let appB: TestApp

  beforeEach(async () => {
    const shared = createEmptyIndexerStorage()
    appA = createTestApp(shared)
    appB = createTestApp(shared)
    await appA.start()
    await appB.start()
  })

  afterEach(async () => {
    await appA.shutdown()
    await appB.shutdown()
  })

  // Ids sort against the save order, so if the versions tied on updatedAt
  // the older one would become current and the test would see it.
  async function twoVersionsInTrips(): Promise<string> {
    const dir = await appA.createDirectory('Trips')
    await addVersion(appA, 'b-v1', 'notes.txt')
    await appA.moveFileToDirectory('b-v1', dir.id)
    // Uploaded before v2 replaces it, since the uploader skips a version that
    // is no longer current, and B would then never get v1.
    await appA.waitForNoActiveUploads()
    await addVersion(appA, 'a-v2', 'notes.txt')
    await appA.moveFileToDirectory('a-v2', dir.id)
    await appA.waitForNoActiveUploads()
    await waitForCondition(
      async () => (await versionIds(appB, 'notes.txt', 'Trips')).length === 2,
      { timeout: 15_000, message: 'device B has both versions in Trips' },
    )
    for (const app of [appA, appB]) {
      expect(await versionIds(app, 'notes.txt', 'Trips')).toEqual(['a-v2', 'b-v1'])
    }
    return dir.id
  }

  async function expectNewerCurrentIn(folder: string): Promise<void> {
    await waitForCondition(async () => (await versionIds(appB, 'notes.txt', folder)).length === 2, {
      timeout: 15_000,
      message: `device B has both versions in ${folder}`,
    })
    for (const app of [appA, appB]) {
      expect(await versionIds(app, 'notes.txt', folder)).toEqual(['a-v2', 'b-v1'])
      expect(await shown(app)).toEqual(['a-v2'])
    }
  }

  it('renaming the folder leaves the newer version current on both devices', async () => {
    const dirId = await twoVersionsInTrips()

    await appA.renameDirectory(dirId, 'Holidays')

    await expectNewerCurrentIn('Holidays')
  }, 60_000)

  it('moving the folder leaves the newer version current on both devices', async () => {
    const dirId = await twoVersionsInTrips()

    await appA.app.directories.moveDirectory(dirId, 'Archive')

    await expectNewerCurrentIn('Archive/Trips')
  }, 60_000)
})
