import type { FileRecord } from '@siastorage/core/types'
import { initializeDB, resetDb } from '../db'
import { app } from './appService'
import { lookupFsFileUri, recordFileUse } from './fs'

const file: FileRecord = {
  id: 'photo-1',
  name: 'photo-1.jpg',
  type: 'image/jpeg',
  kind: 'file',
  size: 100,
  hash: 'sha256:hash-photo-1',
  createdAt: 1,
  updatedAt: 1,
  addedAt: 1,
  mediaAssetId: null,
  trashedAt: null,
  deletedAt: null,
  objects: {},
}

describe('recording use of a local copy', () => {
  beforeEach(async () => {
    await initializeDB()
    await app().files.create(file)
    // An imported copy nobody has opened, as the importer writes it.
    await app().fs.upsertMeta({ fileId: file.id, size: 100, addedAt: 1, usedAt: 0 })
  })

  afterEach(async () => {
    await resetDb()
  })

  test('the lookup library tiles render with does not move the file’s last-used time', async () => {
    expect(await lookupFsFileUri(file)).toBeTruthy()

    expect((await app().fs.readMeta(file.id))?.usedAt).toBe(0)
  })

  test('opening, sharing or saving the file records the use', async () => {
    await recordFileUse(file)

    expect((await app().fs.readMeta(file.id))?.usedAt).toBeGreaterThan(0)
  })

  test('a use that fails to record does not fail the share or save that asked for it', async () => {
    const lookup = jest
      .spyOn(app().fs, 'getFileUri')
      .mockRejectedValueOnce(new Error('database is locked'))

    await expect(recordFileUse(file)).resolves.toBeUndefined()

    lookup.mockRestore()
  })
})
