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

  /** Runs the Mac's pass as if `ahead` had passed since now. */
  async function trashPassAfter(ahead: number): Promise<number> {
    const realNow = Date.now.bind(Date)
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + ahead)
    try {
      return await mac.app.shares.syncLinksAndTrashOlderVersions()
    } finally {
      clock.mockRestore()
    }
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
})
