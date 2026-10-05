/**
 * Share links across devices. A link is a sharing key on the indexer, and each
 * test reads what is attached to it from the shared MockIndexerStorage, which
 * is what a recipient opening the link would see.
 */

import { toContentHash } from '@siastorage/core/lib/contentHash'
import { decodeFileMetadata } from '@siastorage/core/encoding/fileMetadata'
import { createEmptyIndexerStorage, type MockIndexerStorage } from '@siastorage/sdk-mock'
import * as crypto from 'crypto'
import * as nodeFs from 'fs'
import * as path from 'path'
import { createTestApp, type TestApp, waitForCondition } from './app'

/** Adds a file through the test app, which joins the stack of any live file with the same name. */
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

/** What a recipient sees: each attached object's id and the metadata it was attached with. */
function attached(storage: MockIndexerStorage, publicKey: string) {
  const key = storage.sharingKeys.get(publicKey)
  if (!key) return null
  return [...key.objects.entries()].map(([objectId, metadata]) => ({
    objectId,
    metadata: decodeFileMetadata(metadata),
  }))
}

const LATEST = { expiresAt: null, mode: 'latest' } as const
const SNAPSHOT = { expiresAt: null, mode: 'snapshot' } as const

async function objectIdOf(app: TestApp, fileId: string): Promise<string | undefined> {
  const file = await app.getFileById(fileId)
  return file ? Object.values(file.objects)[0]?.id : undefined
}

describe('Share links', () => {
  let storage: MockIndexerStorage
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

  it('a link moves to the version another device saves, and drops the one it replaced', async () => {
    await addFile(appA, 'report-v1', 'report.txt')
    await appA.waitForNoActiveUploads()
    const link = await appA.app.shares.createLink(['report-v1'], LATEST)
    const v1Object = await objectIdOf(appA, 'report-v1')
    expect(attached(storage, link.publicKey)?.map((a) => a.objectId)).toEqual([v1Object])

    await waitForCondition(async () => (await appB.getFileById('report-v1')) !== null, {
      message: 'Device B has report.txt',
    })
    await addFile(appB, 'report-v2', 'report.txt')
    await appB.waitForNoActiveUploads()
    const v2Object = await objectIdOf(appB, 'report-v2')

    await waitForCondition(
      () => {
        const ids = attached(storage, link.publicKey)?.map((a) => a.objectId)
        return ids?.length === 1 && ids[0] === v2Object
      },
      { timeout: 15_000, message: 'the link holds only the new version' },
    )
  }, 30_000)

  it('recipients see the name, type and size, and not the folder or tags', async () => {
    await addFile(appA, 'notes', 'notes.txt')
    const dir = await appA.createDirectory('Private')
    await appA.moveFileToDirectory('notes', dir.id)
    await appA.addTagToFile('notes', 'secret')
    await appA.waitForNoActiveUploads()

    const link = await appA.app.shares.createLink(['notes'], LATEST)
    const [shared] = attached(storage, link.publicKey) ?? []
    expect(shared.metadata.name).toBe('notes.txt')
    expect(shared.metadata.type).toBe('text/plain')
    expect(shared.metadata.size).toBe(1024)
    // The folder and the tag do not travel. Whether the encoder leaves the two
    // fields out or writes them empty, neither names `Private` or `secret`.
    expect(shared.metadata.directory ?? '').toBe('')
    expect(shared.metadata.tags ?? []).toEqual([])
  }, 30_000)

  it('a rename reaches recipients', async () => {
    await addFile(appA, 'draft', 'draft.txt')
    await appA.waitForNoActiveUploads()
    const link = await appA.app.shares.createLink(['draft'], LATEST)

    await appA.app.files.renameFile('draft', 'final.txt')

    await waitForCondition(
      () => attached(storage, link.publicKey)?.[0]?.metadata.name === 'final.txt',
      { message: 'recipients see the new name' },
    )
  }, 30_000)

  it('a trashed file leaves the link and comes back when restored', async () => {
    await addFile(appA, 'photo', 'photo.txt')
    await appA.waitForNoActiveUploads()
    const link = await appA.app.shares.createLink(['photo'], LATEST)

    await appA.app.files.trashFile('photo')
    await waitForCondition(() => attached(storage, link.publicKey)?.length === 0, {
      message: 'the trashed file is off the link',
    })
    expect((await appA.app.shares.links())[0].files).toMatchObject([
      { fileId: 'photo', state: 'trashed' },
    ])

    await appA.app.files.restore(['photo'])
    await waitForCondition(() => attached(storage, link.publicKey)?.length === 1, {
      message: 'the restored file is back on the link',
    })
  }, 30_000)

  it('a link whose first attach fails comes back once with its file pending, and the next pass attaches it', async () => {
    await addFile(appA, 'flaky', 'flaky.txt')
    await appA.waitForNoActiveUploads()
    const failOnce = jest
      .spyOn(appA.sdk, 'shareObject')
      .mockRejectedValueOnce(new Error('connection reset'))

    const link = await appA.app.shares.createLink(['flaky'], LATEST)
    failOnce.mockRestore()

    expect(link.files).toMatchObject([{ fileId: 'flaky', state: 'pending' }])
    expect(storage.sharingKeys.size).toBe(1)
    await waitForCondition(() => attached(storage, link.publicKey)?.length === 1, {
      message: 'the next pass attaches the file',
    })
  }, 30_000)

  it('two files on a link renamed into one stack stay one file, and a new version still reaches it', async () => {
    await addFile(appA, 'left', 'left.txt')
    await addFile(appA, 'right', 'right.txt')
    await appA.waitForNoActiveUploads()
    const link = await appA.app.shares.createLink(['left', 'right'], LATEST)

    await appA.app.files.renameFile('right', 'left.txt')
    await waitForCondition(async () => (await appA.app.shares.links())[0]?.files.length === 1, {
      message: 'the merged stack is one file on the link',
    })

    await addFile(appA, 'left-v3', 'left.txt')
    await appA.waitForNoActiveUploads()
    const v3Object = await objectIdOf(appA, 'left-v3')
    await waitForCondition(
      () =>
        attached(storage, link.publicKey)
          ?.map((a) => a.objectId)
          .join() === v3Object,
      { message: 'the newest version is the only one attached' },
    )
  }, 30_000)

  it('a deleted file leaves the link on both devices', async () => {
    await addFile(appA, 'gone', 'gone.txt')
    await addFile(appA, 'kept', 'kept.txt')
    await appA.waitForNoActiveUploads()
    const link = await appA.app.shares.createLink(['gone', 'kept'], LATEST)
    await waitForCondition(async () => (await appB.app.shares.links())[0]?.files.length === 2, {
      message: 'Device B lists both files on the link',
    })

    await appA.app.files.tombstoneFile('gone')

    await waitForCondition(() => attached(storage, link.publicKey)?.length === 1, {
      message: 'the deleted file is off the link',
    })
    for (const app of [appA, appB]) {
      await waitForCondition(
        async () =>
          JSON.stringify((await app.app.shares.links())[0]?.files.map((f) => f.name)) ===
          JSON.stringify(['kept.txt']),
        { message: 'each device lists only the kept file' },
      )
    }
  }, 30_000)

  it('a link made on one device opens the same on another, which can revoke it', async () => {
    await addFile(appA, 'shared', 'shared.txt')
    await appA.waitForNoActiveUploads()
    const link = await appA.app.shares.createLink(['shared'], LATEST)
    expect(link.url).toMatch(/^https:\/\/share\.sia\.storage\/#share=[0-9a-f]{64}$/)

    await waitForCondition(async () => (await appB.app.shares.links())[0]?.url === link.url, {
      message: 'Device B has the same link',
    })
    await appB.app.shares.revokeLink(link.publicKey)

    expect(storage.sharingKeys.size).toBe(0)
    await waitForCondition(async () => (await appA.app.shares.links()).length === 0, {
      message: 'Device A drops the revoked link',
    })
  }, 30_000)

  it('a file shared before its upload finishes joins the link once it does', async () => {
    await addFile(appA, 'late', 'late.txt')
    const link = await appA.app.shares.createLink(['late'], LATEST)

    await appA.waitForNoActiveUploads()
    await waitForCondition(() => attached(storage, link.publicKey)?.length === 1, {
      message: 'the uploaded file is on the link',
    })
    expect((await appA.app.shares.links())[0].files).toMatchObject([{ state: 'shared' }])
  }, 30_000)

  it('a file removed from a link on one device stays off it on the other', async () => {
    await addFile(appA, 'one', 'one.txt')
    await addFile(appA, 'two', 'two.txt')
    await appA.waitForNoActiveUploads()
    const link = await appA.app.shares.createLink(['one', 'two'], LATEST)
    await waitForCondition(async () => (await appB.app.shares.links())[0]?.files.length === 2, {
      message: 'Device B lists both files',
    })

    await appB.app.shares.removeLinkFiles(link.publicKey, ['one'])

    expect(attached(storage, link.publicKey)?.map((a) => a.metadata.name)).toEqual(['two.txt'])
    await waitForCondition(async () => (await appA.app.shares.links())[0]?.files.length === 1, {
      message: 'Device A lists only the remaining file',
    })
  }, 30_000)

  it('a device that has not synced a rename does not put the old name back', async () => {
    await addFile(appA, 'named', 'old-name.txt')
    await appA.waitForNoActiveUploads()
    const link = await appA.app.shares.createLink(['named'], LATEST)
    await waitForCondition(async () => (await appB.app.shares.links()).length === 1, {
      message: 'Device B has the link',
    })

    // B stops syncing, so it still holds the old name when it next looks at
    // the link. Its pass is then run by hand, the one thing it does here.
    appB.pause()
    await appA.app.files.renameFile('named', 'new-name.txt')
    await waitForCondition(
      () => attached(storage, link.publicKey)?.[0]?.metadata.name === 'new-name.txt',
      { message: 'recipients see the new name' },
    )
    await appB.app.shares.syncLinks({ refresh: true })

    expect(attached(storage, link.publicKey)?.[0]?.metadata.name).toBe('new-name.txt')
    appB.resume()
  }, 30_000)

  it('a pass that changes nothing leaves the list of links alone', async () => {
    await addFile(appA, 'still', 'still.txt')
    await appA.waitForNoActiveUploads()
    await appA.app.shares.createLink(['still'], LATEST)
    await appA.app.shares.syncLinks({ refresh: true })
    appA.pause()
    const invalidate = jest.spyOn(appA.app.caches.shareLinks, 'invalidateAll')

    await appA.app.shares.syncLinks({ refresh: true })

    expect(invalidate).not.toHaveBeenCalled()
    invalidate.mockRestore()
    appA.resume()
  }, 30_000)

  it('a link cannot be made with an expiry that has already passed', async () => {
    await addFile(appA, 'brief', 'brief.txt')
    await appA.waitForNoActiveUploads()
    const create = jest.spyOn(appA.sdk, 'createSharingKey')

    await expect(
      appA.app.shares.createLink(['brief'], { expiresAt: Date.now() - 1, mode: 'latest' }),
    ).rejects.toThrow('A link has to expire in the future')

    expect(create).not.toHaveBeenCalled()
    create.mockRestore()
  })

  it('an expired link is left out of the pass rather than failing on every one', async () => {
    await addFile(appA, 'brief', 'brief.txt')
    await appA.waitForNoActiveUploads()
    appA.pause()
    // The first attach fails, so the file is still waiting to go on the link
    // when the link expires.
    const failOnce = jest
      .spyOn(appA.sdk, 'shareObject')
      .mockRejectedValueOnce(new Error('connection reset'))
    await appA.app.shares.createLink(['brief'], {
      expiresAt: Date.now() + 300,
      mode: 'latest',
    })
    failOnce.mockRestore()
    await new Promise((r) => setTimeout(r, 400))
    const share = jest.spyOn(appA.sdk, 'shareObject')

    await appA.app.shares.syncLinks()

    expect(share).not.toHaveBeenCalled()
    share.mockRestore()
    appA.resume()
  }, 30_000)

  it('sync calls made while a pass waits to start share that pass', async () => {
    const first = appA.app.shares.syncLinks({ refresh: true })
    const second = appA.app.shares.syncLinks({ refresh: true })
    const plain = appA.app.shares.syncLinks()

    expect(second).toBe(first)
    expect(plain).toBe(first)
    await first
  })

  describe('a snapshot link', () => {
    /** Long enough for several sync passes, so a change that should not happen would have. */
    const passes = () => new Promise((r) => setTimeout(r, 1500))

    it('keeps the version it was made with when another device saves a new one', async () => {
      await addFile(appA, 'snap-v1', 'snap.txt')
      await appA.waitForNoActiveUploads()
      const link = await appA.app.shares.createLink(['snap-v1'], SNAPSHOT)
      const v1Object = await objectIdOf(appA, 'snap-v1')
      expect(link.mode).toBe('snapshot')

      await waitForCondition(async () => (await appB.getFileById('snap-v1')) !== null, {
        message: 'Device B has snap.txt',
      })
      await addFile(appB, 'snap-v2', 'snap.txt')
      await appB.waitForNoActiveUploads()
      await waitForCondition(async () => (await appA.getFileById('snap-v2')) !== null, {
        message: 'Device A has the new version',
      })
      await passes()

      expect(attached(storage, link.publicKey)?.map((a) => a.objectId)).toEqual([v1Object])
      expect((await appA.app.shares.links())[0].files).toMatchObject([{ fileId: 'snap-v1' }])
    }, 30_000)

    it('keeps the name it was made with after a rename', async () => {
      await addFile(appA, 'snap-name', 'before.txt')
      await appA.waitForNoActiveUploads()
      const link = await appA.app.shares.createLink(['snap-name'], SNAPSHOT)

      await appA.app.files.renameFile('snap-name', 'after.txt')
      await passes()

      expect(attached(storage, link.publicKey)?.[0]?.metadata.name).toBe('before.txt')
    }, 30_000)

    it('stays a snapshot on another device, which leaves it as it is', async () => {
      await addFile(appA, 'snap-b1', 'shared-snap.txt')
      await appA.waitForNoActiveUploads()
      const link = await appA.app.shares.createLink(['snap-b1'], SNAPSHOT)
      const v1Object = await objectIdOf(appA, 'snap-b1')
      await waitForCondition(async () => (await appB.app.shares.links())[0]?.mode === 'snapshot', {
        message: 'Device B has the link as a snapshot',
      })

      await addFile(appB, 'snap-b2', 'shared-snap.txt')
      await appB.waitForNoActiveUploads()
      await passes()

      expect(attached(storage, link.publicKey)?.map((a) => a.objectId)).toEqual([v1Object])
    }, 30_000)

    it('takes a trashed file off and puts the same version back when it is restored', async () => {
      await addFile(appA, 'snap-trash', 'snap-trash.txt')
      await appA.waitForNoActiveUploads()
      const link = await appA.app.shares.createLink(['snap-trash'], SNAPSHOT)
      const object = await objectIdOf(appA, 'snap-trash')

      await appA.app.files.trashFile('snap-trash')
      await waitForCondition(() => attached(storage, link.publicKey)?.length === 0, {
        message: 'the trashed file is off the snapshot',
      })
      expect((await appA.app.shares.links())[0].files).toMatchObject([
        { fileId: 'snap-trash', state: 'trashed' },
      ])

      await appA.app.files.restore(['snap-trash'])
      await waitForCondition(
        () =>
          attached(storage, link.publicKey)
            ?.map((a) => a.objectId)
            .join() === object,
        { message: 'the same version is back on the snapshot' },
      )
    }, 30_000)

    it('takes the version saved over a file shared before it uploaded, since the replaced one never uploads', async () => {
      await addFile(appA, 'snap-old', 'snap-race.txt')
      const link = await appA.app.shares.createLink(['snap-old'], SNAPSHOT)
      await addFile(appA, 'snap-new', 'snap-race.txt')
      await appA.waitForNoActiveUploads()
      const newObject = await objectIdOf(appA, 'snap-new')

      await waitForCondition(
        () =>
          attached(storage, link.publicKey)
            ?.map((a) => a.objectId)
            .join() === newObject,
        { message: 'the version that replaced it is on the snapshot' },
      )
      expect(await objectIdOf(appA, 'snap-old')).toBeUndefined()
    }, 30_000)

    it('keeps the version a file was shared as when its first attach failed and a newer one uploaded since', async () => {
      await addFile(appA, 'snap-kept', 'snap-kept.txt')
      await appA.waitForNoActiveUploads()
      const keptObject = await objectIdOf(appA, 'snap-kept')
      const failOnce = jest
        .spyOn(appA.sdk, 'shareObject')
        .mockRejectedValueOnce(new Error('connection reset'))
      const link = await appA.app.shares.createLink(['snap-kept'], SNAPSHOT)
      failOnce.mockRestore()

      await addFile(appA, 'snap-later', 'snap-kept.txt')
      await appA.waitForNoActiveUploads()
      await waitForCondition(() => attached(storage, link.publicKey)?.length === 1, {
        message: 'the file is on the snapshot',
      })
      await passes()
      expect(attached(storage, link.publicKey)?.map((a) => a.objectId)).toEqual([keptObject])
    }, 30_000)

    it('drops a file whose version never uploaded when the version replacing it is already on the link', async () => {
      await addFile(appA, 'merge-other', 'merge-other.txt')
      await appA.waitForNoActiveUploads()
      // The pass is run by hand once the files are in place, so it cannot
      // take the replacing version before the rename puts it on the link.
      appA.pause()
      await addFile(appA, 'merge-old', 'merge.txt')
      const link = await appA.app.shares.createLink(['merge-old', 'merge-other'], SNAPSHOT)
      await addFile(appA, 'merge-new', 'merge.txt')
      await appA.waitForNoActiveUploads()
      expect(await objectIdOf(appA, 'merge-old')).toBeUndefined()
      // merge-other joins merge.txt's stack as its newest version, which is
      // where merge-old's row falls back to.
      await appA.app.files.renameFile('merge-other', 'merge.txt')

      await appA.app.shares.syncLinks({ refresh: true })

      expect((await appA.app.shares.links())[0].files).toMatchObject([
        { fileId: 'merge-other', state: 'shared' },
      ])
      expect(attached(storage, link.publicKey)).toHaveLength(1)
      appA.resume()
    }, 30_000)

    it('takes a file shared before its upload finished once it does', async () => {
      await addFile(appA, 'snap-late', 'snap-late.txt')
      const link = await appA.app.shares.createLink(['snap-late'], SNAPSHOT)

      await appA.waitForNoActiveUploads()
      await waitForCondition(() => attached(storage, link.publicKey)?.length === 1, {
        message: 'the uploaded file is on the snapshot',
      })
    }, 30_000)
  })
})
