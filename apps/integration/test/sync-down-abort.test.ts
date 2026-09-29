import { createHash } from 'node:crypto'
import { toContentHash } from '@siastorage/core/lib/contentHash'
import { createEmptyIndexerStorage, generateMockFileMetadata } from '@siastorage/sdk-mock'
import { createTestApp, type TestApp, waitForCondition } from './app'

describe('Sync-down interrupted by suspension', () => {
  let app: TestApp

  beforeEach(async () => {
    app = createTestApp(createEmptyIndexerStorage())
    await app.start()
  })

  afterEach(async () => {
    await app.shutdown()
  })

  it('keeps the cursor on a batch a suspension stopped it applying, so the run after resume applies it', async () => {
    // Suspends the app once sync-down has fetched the batch and before it
    // applies it. Only sync-down reads object events, so no other service can
    // trip the suspension, and an empty poll before the injection is skipped.
    const objectEvents = app.sdk.objectEvents.bind(app.sdk)
    let suspended = false
    jest.spyOn(app.sdk, 'objectEvents').mockImplementation(async (cursor, limit) => {
      const events = await objectEvents(cursor, limit)
      if (!suspended && events.length > 0) {
        suspended = true
        await app.suspend()
      }
      return events
    })
    const now = Date.now()
    for (let i = 0; i < 3; i++) {
      app.sdk.injectObject({
        metadata: {
          id: `file-${i}`,
          name: `f-${i}.bin`,
          type: 'application/octet-stream',
          kind: 'file',
          size: 1024,
          hash: toContentHash(createHash('sha256').update(`f-${i}`).digest('hex')),
          createdAt: now,
          updatedAt: now,
          trashedAt: null,
        },
      })
    }

    await waitForCondition(() => app.isSuspended(), { message: 'the app to suspend mid-batch' })
    expect(await app.getFiles()).toHaveLength(0)

    await app.resumeFromSuspension()
    await waitForCondition(async () => (await app.getFiles()).length === 3, {
      timeout: 10_000,
      message: 'the batch to apply after resume',
    })
    expect((await app.getFiles()).map((f) => f.id).sort()).toEqual(['file-0', 'file-1', 'file-2'])
  })

  it('refreshes the library when a suspension lands after a delete has committed', async () => {
    const stored = app.sdk.injectObject({
      metadata: generateMockFileMetadata(1, { name: 'gone.txt' }),
    })
    await app.waitForFileCount(1)
    const fileId = (await app.getFiles())[0].id

    // The file cleanup after the commit is where the suspension lands, so the
    // delete is already in the database when sync-down stops.
    jest.spyOn(app.app.fs, 'removeFile').mockImplementationOnce(async () => {
      await app.suspend()
    })
    const refreshed = jest.spyOn(app.app.caches.library, 'invalidateAll')
    app.sdk.injectDeleteEvent(stored.id)

    await waitForCondition(() => app.isSuspended(), {
      message: 'the app to suspend after the commit',
    })
    expect((await app.getFileById(fileId))?.deletedAt).not.toBeNull()
    expect(refreshed).toHaveBeenCalled()
  })
})
