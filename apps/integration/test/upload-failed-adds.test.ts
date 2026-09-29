import { toContentHash } from '@siastorage/core/lib/contentHash'
import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import { createHash } from 'crypto'
import { createTestApp, generateTestFiles } from './app'

describe('Failed adds', () => {
  it('adds that fail in the middle of a batch leave every file pointing at its own bytes', async () => {
    const storage = createEmptyIndexerStorage()
    const app = createTestApp(storage)
    await app.start()
    try {
      // The first add is the packer's, the next seven share one window, so
      // four of the window's adds fail before three succeed.
      storage.failingAdds = 5
      const files = await app.addFiles(generateTestFiles(8, { sizeBytes: 4096 }))

      await app.waitForCondition(async () => {
        for (const file of files) {
          if ((await app.readLocalObjectsForFile(file.id)).length === 0) return false
        }
        return true
      }, 60_000)

      for (const file of files) {
        const [object] = await app.readLocalObjectsForFile(file.id)
        const bytes = Buffer.from(await app.sdk.downloadByObjectId(object.id))
        const hash = toContentHash(createHash('sha256').update(bytes).digest('hex'))
        expect({ file: file.name, hash }).toEqual({ file: file.name, hash: file.hash })
      }
    } finally {
      await app.shutdown()
    }
  })
})
