/*
 * A transaction body reaches the library through a facade bound to its
 * transaction. Cache invalidations it triggers wait for the commit, because a
 * refresh run inside the transaction would re-run queries that wait for it.
 */
import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import { createTestApp, generateTestFiles, type TestApp } from './app'

describe('Cache invalidation inside a transaction', () => {
  let app: TestApp

  beforeEach(async () => {
    app = createTestApp(createEmptyIndexerStorage())
    await app.start()
  })

  afterEach(async () => {
    await app.shutdown()
  })

  it('runs after the transaction commits, not inside it', async () => {
    const [file] = await app.addFiles(generateTestFiles(1, { startId: 1 }))
    const invalidate = jest.spyOn(app.app.caches.fileById, 'invalidate')
    let calledInside = true

    await app.internal.withTransaction(async (tx) => {
      await tx.files.update({ id: file.id, name: 'renamed.bin' }, { updatedAt: 'now' })
      calledInside = invalidate.mock.calls.length > 0
    })

    expect(calledInside).toBe(false)
    expect(invalidate).toHaveBeenCalled()
  })

  it('is dropped when the transaction rolls back', async () => {
    const [file] = await app.addFiles(generateTestFiles(1, { startId: 1 }))
    const invalidate = jest.spyOn(app.app.caches.fileById, 'invalidate')

    await expect(
      app.internal.withTransaction(async (tx) => {
        await tx.files.update({ id: file.id, name: 'renamed.bin' }, { updatedAt: 'now' })
        throw new Error('batch failed')
      }),
    ).rejects.toThrow('batch failed')

    expect(invalidate).not.toHaveBeenCalled()
  })
})
