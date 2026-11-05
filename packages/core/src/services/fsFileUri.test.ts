import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { readFsMeta } from '../db/operations/fs'
import { db, setupTestDb, teardownTestDb } from '../db/operations/test-setup'
import { type FsFileUriAdapter, getFsFileUri } from './fsFileUri'

const file = { id: 'photo', type: 'image/jpeg' }

describe('getFsFileUri', () => {
  beforeEach(setupTestDb)
  afterEach(teardownTestDb)

  it('a background read rebuilding a missing row keeps the use time a user read just recorded', async () => {
    let releaseBackground!: () => void
    const backgroundWaits = new Promise<void>((resolve) => {
      releaseBackground = resolve
    })
    let calls = 0
    const adapter: FsFileUriAdapter = {
      uri: () => 'file:///files/photo.jpg',
      size: async () => {
        // The first caller, the background read, waits on the size until
        // the user's read has recorded its row.
        if (calls++ === 0) await backgroundWaits
        return { value: 100 }
      },
    }

    const background = getFsFileUri(db(), file, adapter)
    await getFsFileUri(db(), file, adapter, { recordUse: true })
    const usedByUser = (await readFsMeta(db(), file.id))?.usedAt
    releaseBackground()
    await background

    expect(usedByUser).toBeGreaterThan(0)
    expect((await readFsMeta(db(), file.id))?.usedAt).toBe(usedByUser)
  })

  it('a background read with no row to race records the copy as unused', async () => {
    const adapter: FsFileUriAdapter = {
      uri: () => 'file:///files/photo.jpg',
      size: async () => ({ value: 100 }),
    }
    await getFsFileUri(db(), file, adapter)
    expect((await readFsMeta(db(), file.id))?.usedAt).toBe(0)
  })
})
