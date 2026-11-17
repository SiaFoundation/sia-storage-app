import * as nodeFs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { runShareLinkSync } from '@siastorage/core/services'
import { createEmptyIndexerStorage, type MockIndexerStorage } from '@siastorage/sdk-mock'
import { createTestApp } from './app'

/*
 * An older version goes to the trash once the version that replaced it is a
 * day old. The pass reads the clock through Date.now, which these tests move
 * forward only while that call runs, so sync before and after it runs on real
 * time.
 */
const DAY = 24 * 60 * 60 * 1000

describe('Trashing older versions', () => {
  let storage: MockIndexerStorage
  let handoff: string
  let mac: ReturnType<typeof createTestApp>
  let phone: ReturnType<typeof createTestApp>
  let staged = 0
  const stage = (text: string) => {
    const file = path.join(handoff, `staged-${++staged}`)
    nodeFs.writeFileSync(file, text)
    return file
  }

  beforeEach(async () => {
    storage = createEmptyIndexerStorage()
    handoff = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'older-version-trash-'))
    mac = createTestApp(storage, { handoffDir: handoff })
    phone = createTestApp(storage, { handoffDir: handoff })
    await mac.start()
    await phone.start()
  })

  afterEach(async () => {
    await phone.shutdown()
    await mac.shutdown()
    nodeFs.rmSync(handoff, { recursive: true, force: true })
  })

  /** Runs `app`'s pass as if `ahead` had passed since now. */
  async function trashPassAfter(ahead: number, app = mac): Promise<number> {
    const realNow = Date.now.bind(Date)
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + ahead)
    try {
      return await app.app.shares.syncLinksAndTrashOlderVersions()
    } finally {
      clock.mockRestore()
    }
  }

  /** Waits until `app` has pushed every change it made to the indexer. */
  async function pushed(app: typeof mac): Promise<void> {
    const indexerURL = await app.app.settings.getIndexerURL()
    await app.waitForCondition(
      async () => (await app.app.localObjects.countSyncUp(indexerURL)) === 0,
      30_000,
    )
  }

  /** Saves notes.txt on the Mac and over it once, and waits until both devices hold both versions uploaded. */
  async function savedTwice(): Promise<{ current: string; older: string }> {
    const created = await mac.app.provider.create(null, 'notes.txt', 'file', stage('one'))
    // A second save in the same millisecond would order the versions by id.
    await new Promise((resolve) => setTimeout(resolve, 5))
    await mac.app.provider.write(created.id, stage('two'))
    const [current, older] = await versionIds(mac)
    await phone.waitForCondition(async () => {
      const objects = await Promise.all(
        [current, older].map((id) => mac.readLocalObjectsForFile(id)),
      )
      return objects.every((o) => o.length > 0) && (await versionIds(phone)).length === 2
    }, 30_000)
    return { current, older }
  }

  /** Runs `app`'s share-link pass as if `ahead` had passed since now. */
  async function shareLinkPassAfter(app: typeof mac, ahead: number): Promise<void> {
    const realNow = Date.now.bind(Date)
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + ahead)
    try {
      await runShareLinkSync(app.app)
    } finally {
      clock.mockRestore()
    }
  }

  async function versionIds(app: typeof mac): Promise<string[]> {
    return (await app.app.files.getVersionHistory('notes.txt', null)).map((v) => v.id)
  }

  it('moves a version saved over to the trash on every device a day later, and keeps the current one', async () => {
    const created = await mac.app.provider.create(null, 'notes.txt', 'file', stage('one'))
    await mac.app.provider.write(created.id, stage('two'))
    const [current, older] = await versionIds(mac)
    expect(older).toBe(created.id)
    await phone.waitForCondition(async () => {
      const objects = await Promise.all(
        [current, older].map((id) => mac.readLocalObjectsForFile(id)),
      )
      return objects.every((o) => o.length > 0) && (await versionIds(phone)).length === 2
    }, 30_000)

    expect(await trashPassAfter(DAY / 2)).toBe(0)
    expect(await trashPassAfter(DAY + 1000)).toBe(1)

    expect(await versionIds(mac)).toEqual([current])
    await phone.waitForCondition(async () => (await versionIds(phone)).length === 1, 30_000)
    expect(await versionIds(phone)).toEqual([current])
    const [entry] = await phone.app.files.trashEntries()
    expect(entry).toMatchObject({ name: 'notes.txt', versions: 1 })
  })

  it('leaves an older version that a link made on another device shows, on a device that had not listed that link yet', async () => {
    // Its own pass never runs, so the link reaches it only through the pass below.
    const laptop = createTestApp(storage, {
      handoffDir: handoff,
      shareLinkPass: { interval: 60 * 60 * 1000, refresh: false },
    })
    await laptop.start()
    try {
      const created = await mac.app.provider.create(null, 'notes.txt', 'file', stage('one'))
      await mac.app.provider.write(created.id, stage('two'))
      await laptop.waitForCondition(async () => {
        const uploaded = await Promise.all(
          (await versionIds(mac)).map(async (id) => (await mac.readLocalObjectsForFile(id)).length),
        )
        return uploaded.every((n) => n > 0) && (await versionIds(laptop)).length === 2
      }, 30_000)
      await mac.app.shares.createLink([created.id], { expiresAt: null, mode: 'snapshot' })

      await shareLinkPassAfter(laptop, DAY + 1000)

      expect(await versionIds(laptop)).toContain(created.id)
      expect((await laptop.app.shares.links())[0]?.files).toHaveLength(1)
    } finally {
      await laptop.shutdown()
    }
  }, 60_000)

  it('leaves a version restored on another device restored when this device trashes it before syncing the restore', async () => {
    const { current, older } = await savedTwice()
    mac.pause()

    expect(await trashPassAfter(DAY + 1000, phone)).toBe(1)
    const [entry] = await phone.app.files.trashEntries()
    await phone.app.files.restoreTrashEntries([entry.id])
    expect(await versionIds(phone)).toEqual([older, current])
    await pushed(phone)

    // The Mac has seen neither the phone's trash nor its restore.
    expect(await trashPassAfter(DAY + 1000)).toBe(1)
    mac.resume()

    await mac.waitForCondition(
      async () => (await versionIds(mac)).join() === [older, current].join(),
      30_000,
    )
    await pushed(mac)
    await pushed(phone)
    expect(await versionIds(phone)).toEqual([older, current])
    expect(await phone.app.files.trashEntries()).toEqual([])
  }, 60_000)

  it('restores a version on a device that first saw it in the trash as a version of its file', async () => {
    const { current, older } = await savedTwice()
    expect(await trashPassAfter(DAY + 1000)).toBe(1)
    await pushed(mac)

    const laptop = createTestApp(storage, { handoffDir: handoff })
    await laptop.start()
    try {
      await laptop.waitForCondition(
        async () =>
          (await versionIds(laptop)).join() === current &&
          (await laptop.app.files.trashEntries()).length === 1,
        30_000,
      )
      const [entry] = await laptop.app.files.trashEntries()
      expect(await laptop.app.files.restoreTrashEntries([entry.id])).toEqual([
        { id: older, name: 'notes.txt', renamedFrom: null },
      ])

      expect(await versionIds(laptop)).toEqual([older, current])
      await mac.waitForCondition(
        async () => (await versionIds(mac)).join() === [older, current].join(),
        30_000,
      )
      for (const app of [laptop, mac]) {
        expect((await app.app.files.query({ order: 'ASC' })).map((f) => f.name)).toEqual([
          'notes.txt',
        ])
      }
    } finally {
      await laptop.shutdown()
    }
  }, 60_000)

  it('leaves an older version that has not uploaded', async () => {
    const created = await mac.app.provider.create(null, 'notes.txt', 'file', stage('one'))
    await mac.waitForCondition(
      async () => (await mac.readLocalObjectsForFile(created.id)).length > 0,
      30_000,
    )
    const pin = jest
      .spyOn(mac.sdk, 'pinObject')
      .mockRejectedValue(new Error('simulated network failure'))
    await mac.app.provider.write(created.id, stage('two'))
    const [unuploaded] = await versionIds(mac)
    await mac.waitForCondition(() => pin.mock.calls.length > 0, 30_000)
    await phone.app.provider.write(created.id, stage('three'))
    await mac.waitForCondition(async () => (await versionIds(mac)).length === 3, 30_000)

    // The first version uploaded and goes. The Mac's edit has no copy on the
    // network yet, so it stays.
    expect(await trashPassAfter(DAY + 1000)).toBe(1)
    expect(await versionIds(mac)).toContain(unuploaded)
    expect(await versionIds(mac)).not.toContain(created.id)
    pin.mockRestore()
  })

  it('leaves an older version while the version replacing it has not uploaded', async () => {
    const created = await mac.app.provider.create(null, 'notes.txt', 'file', stage('one'))
    await mac.waitForCondition(
      async () => (await mac.readLocalObjectsForFile(created.id)).length > 0,
      30_000,
    )
    const pin = jest
      .spyOn(mac.sdk, 'pinObject')
      .mockRejectedValue(new Error('simulated network failure'))
    try {
      await mac.app.provider.write(created.id, stage('two'))
      await mac.waitForCondition(() => pin.mock.calls.length > 0, 30_000)

      // The phone can hold only the first version, so trashing it would empty the
      // file there.
      expect(await trashPassAfter(DAY + 1000)).toBe(0)
      expect(await versionIds(mac)).toContain(created.id)
    } finally {
      pin.mockRestore()
    }
  })
})
