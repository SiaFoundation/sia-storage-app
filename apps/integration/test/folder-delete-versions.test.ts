/**
 * Deleting a folder that holds several versions of one file, on the device
 * that deletes it and on a device that syncs the delete. Deleting a folder
 * clears the folder on every row still in it, and those writes once failed
 * when two of the rows were versions of one file, which rolled back the
 * whole operation: Finder could not trash the folder, and the other
 * device's sync-down failed on every pass from then on.
 */

import { toContentHash } from '@siastorage/core/lib/contentHash'
import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import * as crypto from 'crypto'
import * as nodeFs from 'fs'
import * as path from 'path'
import { createTestApp, type TestApp, waitForCondition } from './app'

async function addFile(app: TestApp, id: string, name: string): Promise<void> {
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

/** notes.txt in Trips with two versions, uploaded and on both devices. */
async function twoVersionsInAFolder(appA: TestApp, appB: TestApp): Promise<string> {
  const dir = await appA.createDirectory('Trips')
  await addFile(appA, 'v1', 'notes.txt')
  await appA.moveFileToDirectory('v1', dir.id)
  // Uploaded before v2 replaces it, since the uploader skips a version that
  // is no longer current, and B would then never get v1.
  await appA.waitForNoActiveUploads()
  await addFile(appA, 'v2', 'notes.txt')
  await appA.moveFileToDirectory('v2', dir.id)
  await appA.waitForNoActiveUploads()
  const versions = await appA.app.files.getVersionHistory('notes.txt', dir.id)
  expect(versions.map((v) => v.id)).toEqual(['v2', 'v1'])
  await waitForCondition(
    async () =>
      (await appB.readDirectoryPathForFile('v1')) === 'Trips' &&
      (await appB.readDirectoryPathForFile('v2')) === 'Trips',
    { timeout: 15_000, message: 'Device B has both versions in Trips' },
  )
  return dir.id
}

/** Device A adds a file, and B receiving it shows B's sync-down still runs. */
async function stillSyncing(appA: TestApp, appB: TestApp): Promise<void> {
  await addFile(appA, 'after', 'after.txt')
  await waitForCondition(async () => (await appB.getFileById('after')) !== null, {
    timeout: 15_000,
    message: "Device B receives a file added after the delete, so its sync-down didn't stop",
  })
}

describe('Deleting a folder that holds two versions of one file', () => {
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

  it('trashing the folder succeeds, and the other device takes the trash and keeps syncing', async () => {
    const dirId = await twoVersionsInAFolder(appA, appB)

    await appA.app.directories.deleteAndTrashFiles(dirId)

    expect((await appA.getFileById('v1'))?.trashedAt).not.toBeNull()
    expect((await appA.getFileById('v2'))?.trashedAt).not.toBeNull()
    await waitForCondition(
      async () =>
        (await appB.getFileById('v1'))?.trashedAt != null &&
        (await appB.getFileById('v2'))?.trashedAt != null,
      { timeout: 15_000, message: 'Device B has both versions trashed' },
    )
    await stillSyncing(appA, appB)
  }, 60_000)

  it('deleting the file for good empties the folder on the other device, whose sync-down keeps running', async () => {
    await twoVersionsInAFolder(appA, appB)
    expect(await appB.app.directories.getByPath('Trips')).not.toBeNull()

    await appA.app.files.tombstoneFile('v2')

    await waitForCondition(async () => (await appB.app.directories.getByPath('Trips')) === null, {
      timeout: 15_000,
      message: 'Device B deletes the folder the file left empty',
    })
    await stillSyncing(appA, appB)
  }, 60_000)
})
