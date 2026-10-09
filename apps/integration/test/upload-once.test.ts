import type { FsIOAdapter } from '@siastorage/core/services/fsFileUri'
import { createEmptyIndexerStorage, type MockIndexerStorage } from '@siastorage/sdk-mock'
import { createFsAdapter } from './adapters/fs'
import { createTestApp, generateTestFiles } from './app'

const target = 'test-file-1'

/*
 * An app whose uploader poll is held at its first stat of the target's local
 * copy, as on a slow disk. The poll stats each candidate after it has read
 * the ids already uploading, so a call made while it is held lands inside
 * that window. addFiles writes the fixture into the app's temp dir, known
 * only once the app exists, so the real adapter is built then.
 */
async function startWithHeldPoll(storage: MockIndexerStorage) {
  let real: FsIOAdapter | null = null
  let releaseStat: (() => void) | null = null
  let holdNextStat = true
  const app = createTestApp(storage, {
    fsIO: {
      uri: (fileId, type) => real!.uri(fileId, type),
      remove: (fileId, type) => real!.remove(fileId, type),
      size: async (fileId, type) => {
        if (fileId === target && holdNextStat) {
          holdNextStat = false
          await new Promise<void>((resolve) => {
            releaseStat = resolve
          })
        }
        return real!.size(fileId, type)
      },
    },
  })
  real = createFsAdapter({ tempDir: app.tempDir }).fsIO
  await app.start()
  const [file] = await app.addFiles(generateTestFiles(1, { sizeBytes: 4096 }))
  expect(file.id).toBe(target)
  await app.waitForCondition(() => releaseStat !== null)
  return { app, release: () => releaseStat!() }
}

async function expectPinnedOnce(
  app: Awaited<ReturnType<typeof startWithHeldPoll>>['app'],
  storage: MockIndexerStorage,
) {
  await app.waitForCondition(
    async () => (await app.readLocalObjectsForFile(target)).length > 0,
    30_000,
  )
  await app.waitForNoActiveUploads()

  expect(await app.readLocalObjectsForFile(target)).toHaveLength(1)
  expect(storage.objects.size).toBe(1)
  expect(storage.events.filter((event) => !event.deleted)).toHaveLength(1)
}

describe('Upload once', () => {
  it('uploads and pins a file once when it is enqueued while the poll is reading candidates', async () => {
    const storage = createEmptyIndexerStorage()
    const { app, release } = await startWithHeldPoll(storage)
    try {
      const { queued } = await app.app.uploader.enqueueByIds([target])
      expect(queued).toBe(1)
      release()

      await expectPinnedOnce(app, storage)
    } finally {
      await app.shutdown()
    }
  })

  it('queues a file once when a request names it twice or it is already queued, and counts the rest as skipped', async () => {
    const storage = createEmptyIndexerStorage()
    const { app, release } = await startWithHeldPoll(storage)
    try {
      expect(await app.app.uploader.enqueueByIds([target, target])).toEqual({
        queued: 1,
        skipped: 1,
      })
      expect(await app.app.uploader.enqueueByIds([target])).toEqual({ queued: 0, skipped: 1 })
      release()

      await expectPinnedOnce(app, storage)
    } finally {
      await app.shutdown()
    }
  })
})
