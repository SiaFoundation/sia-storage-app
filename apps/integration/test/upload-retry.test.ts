import * as nodeFs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createEmptyIndexerStorage, type MockIndexerStorage } from '@siastorage/sdk-mock'
import { createTestApp, generateTestFiles } from './app'

/*
 * The integration setup sets the retry delay after a failed add to 1.5s,
 * doubling to at most 6s, and after a failed batch send to 1s, doubling to
 * at most 8s. Without the delay, the poll takes a failed file again as soon
 * as it fails, with no wait at all.
 */
const BASE_DELAY = 1500
const MAX_DELAY = 6000
const NETWORK_BASE_DELAY = 1000

/** Fails every add of the file whose path holds `fileId`, recording when each was tried. */
function failAddsOf(storage: MockIndexerStorage, fileId: string) {
  const attempts: number[] = []
  let failing = true
  storage.beforeAdd = async (path) => {
    if (!path.includes(fileId)) return
    attempts.push(Date.now())
    if (failing) throw new Error(`could not read ${path}`)
  }
  return { attempts, stopFailing: () => (failing = false) }
}

const gapsBetween = (times: number[]) => times.slice(1).map((at, i) => at - times[i])

describe('Upload retries', () => {
  it('tries a file whose upload keeps failing again after a delay that doubles, then uploads it once it can', async () => {
    const storage = createEmptyIndexerStorage()
    const app = createTestApp(storage)
    const [file] = generateTestFiles(1, { sizeBytes: 4096 })
    const failing = failAddsOf(storage, 'test-file-1')
    await app.start()
    try {
      await app.addFiles([file])
      await app.waitForCondition(() => failing.attempts.length >= 4, 30_000)

      const gaps = gapsBetween(failing.attempts)
      // Timer slop allows a little under each delay. The poll adds up to a
      // second on top, which is under the next doubling.
      expect(gaps[0]).toBeGreaterThanOrEqual(BASE_DELAY - 100)
      expect(gaps[1]).toBeGreaterThanOrEqual(2 * BASE_DELAY - 100)
      expect(gaps[2]).toBeGreaterThanOrEqual(MAX_DELAY - 100)
      expect(gaps[0]).toBeLessThan(gaps[1])
      expect(gaps[1]).toBeLessThan(gaps[2])
      expect(app.getUploadState('test-file-1')?.status).toBe('error')

      failing.stopFailing()
      await app.waitForCondition(
        async () => (await app.readLocalObjectsForFile('test-file-1')).length > 0,
        30_000,
      )
    } finally {
      await app.shutdown()
    }
  })

  it('tries a file at once when it is asked for directly, and restarts its delay at the base', async () => {
    const storage = createEmptyIndexerStorage()
    const app = createTestApp(storage)
    const failing = failAddsOf(storage, 'test-file-1')
    await app.start()
    try {
      await app.addFiles(generateTestFiles(1, { sizeBytes: 4096 }))
      // Three failures in a row put the next attempt the full 6s away.
      // The entry turns to error once the third failure is recorded, and only
      // then would a direct enqueue take the file rather than skip it as active.
      await app.waitForCondition(
        () => failing.attempts.length >= 3 && app.getUploadState('test-file-1')?.status === 'error',
        30_000,
      )

      const askedAt = Date.now()
      expect(await app.app.uploader.enqueueByIds(['test-file-1'])).toEqual({
        queued: 1,
        skipped: 0,
      })
      await app.waitForCondition(() => failing.attempts.length >= 5, 30_000)

      const [direct, next] = failing.attempts.slice(3)
      expect(direct - askedAt).toBeLessThan(1000)
      expect(next - direct).toBeLessThan(MAX_DELAY - 2000)

      failing.stopFailing()
      await app.waitForCondition(
        async () => (await app.readLocalObjectsForFile('test-file-1')).length > 0,
        30_000,
      )
    } finally {
      await app.shutdown()
    }
  })

  it('tries a file whose batch keeps failing to send again after a delay that doubles', async () => {
    const storage = createEmptyIndexerStorage()
    const app = createTestApp(storage)
    const failures: number[] = []
    const setError = app.app.uploads.setError.bind(app.app.uploads)
    jest.spyOn(app.app.uploads, 'setError').mockImplementation((id, message) => {
      if (id === 'test-file-1') failures.push(Date.now())
      setError(id, message)
    })
    storage.uploadFailures.set('any', new Error('simulated network failure'))
    await app.start()
    try {
      await app.addFiles(generateTestFiles(1, { sizeBytes: 4096 }))
      await app.waitForCondition(() => failures.length >= 4, 30_000)

      const gaps = gapsBetween(failures)
      expect(gaps[1]).toBeGreaterThanOrEqual(2 * NETWORK_BASE_DELAY - 100)
      expect(gaps[2]).toBeGreaterThanOrEqual(4 * NETWORK_BASE_DELAY - 100)

      storage.uploadFailures.clear()
      await app.waitForCondition(
        async () => (await app.readLocalObjectsForFile('test-file-1')).length > 0,
        30_000,
      )
    } finally {
      await app.shutdown()
    }
  })

  it('tries a failed file at once when the connection comes back', async () => {
    const storage = createEmptyIndexerStorage()
    const app = createTestApp(storage)
    const failures: number[] = []
    const setError = app.app.uploads.setError.bind(app.app.uploads)
    jest.spyOn(app.app.uploads, 'setError').mockImplementation((id, message) => {
      if (id === 'test-file-1') failures.push(Date.now())
      setError(id, message)
    })
    storage.uploadFailures.set('any', new Error('simulated network failure'))
    await app.start()
    try {
      await app.addFiles(generateTestFiles(1, { sizeBytes: 4096 }))
      // Four failures in a row put the next attempt 8s away.
      await app.waitForCondition(() => failures.length >= 4, 30_000)
      storage.uploadFailures.clear()
      app.setConnected(false)
      // Long enough for the 1s poll to run while offline.
      await new Promise((resolve) => setTimeout(resolve, 1500))

      const backAt = Date.now()
      app.setConnected(true)
      await app.waitForCondition(
        async () => (await app.readLocalObjectsForFile('test-file-1')).length > 0,
        30_000,
      )
      expect(Date.now() - backAt).toBeLessThan(4000)
    } finally {
      await app.shutdown()
    }
  })

  it('tries a failed file at once when the indexer answers again, though the connection state never changed', async () => {
    const storage = createEmptyIndexerStorage()
    const app = createTestApp(storage)
    const failures: number[] = []
    const setError = app.app.uploads.setError.bind(app.app.uploads)
    jest.spyOn(app.app.uploads, 'setError').mockImplementation((id, message) => {
      if (id === 'test-file-1') failures.push(Date.now())
      setError(id, message)
    })
    // As on the CLI and desktop daemon, isConnected stays true through the
    // outage, and only the indexer's answers show it.
    storage.uploadFailures.set('any', new Error('simulated network failure'))
    const account = jest
      .spyOn(app.app, 'account')
      .mockRejectedValue(new Error('simulated network failure'))
    await app.start()
    try {
      await app.addFiles(generateTestFiles(1, { sizeBytes: 4096 }))
      // Four failures in a row put the next attempt 8s away.
      await app.waitForCondition(() => failures.length >= 4, 30_000)
      await app.waitForCondition(() => account.mock.calls.length > 0, 30_000)

      const backAt = Date.now()
      storage.uploadFailures.clear()
      account.mockRestore()
      await app.waitForCondition(
        async () => (await app.readLocalObjectsForFile('test-file-1')).length > 0,
        30_000,
      )
      expect(Date.now() - backAt).toBeLessThan(4000)
    } finally {
      await app.shutdown()
    }
  })

  describe('an edit on the Mac that another device replaces before it uploads', () => {
    let handoff: string
    let storage: MockIndexerStorage
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
      handoff = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'retry-older-'))
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

    /** Creates notes.txt on the Mac and waits until the phone has it. */
    async function createShared(): Promise<string> {
      const created = await mac.app.provider.create(null, 'notes.txt', 'file', stage('one'))
      await mac.waitForCondition(
        async () => (await mac.readLocalObjectsForFile(created.id)).length > 0,
        30_000,
      )
      await phone.waitForCondition(
        async () => (await phone.app.files.getVersionHistory('notes.txt', null)).length === 1,
        30_000,
      )
      return created.id
    }

    /** Saves a newer version on the phone and waits until the Mac has it. */
    async function phoneSavesOver(id: string, macEdit: string): Promise<void> {
      await phone.app.provider.write(id, stage('phone edit'))
      await mac.waitForCondition(async () => {
        const versions = await mac.app.files.getVersionHistory('notes.txt', null)
        return versions.length === 3 && versions[0].id !== macEdit
      }, 30_000)
    }

    /** Waits until the phone's version history holds the Mac's edit. */
    async function phoneHasVersion(macEdit: string): Promise<void> {
      await phone.waitForCondition(async () => {
        const versions = await phone.app.files.getVersionHistory('notes.txt', null)
        return versions.some((v) => v.id === macEdit)
      }, 30_000)
    }

    it('uploads it after its pin failed', async () => {
      const id = await createShared()
      const pin = jest
        .spyOn(mac.sdk, 'pinObject')
        .mockRejectedValue(new Error('simulated network failure'))
      await mac.app.provider.write(id, stage('mac edit'))
      await mac.waitForCondition(() => pin.mock.calls.length > 0, 30_000)
      const [macEdit] = await mac.app.files.getVersionHistory('notes.txt', null)

      await phoneSavesOver(id, macEdit.id)
      await mac.waitForCondition(() => mac.getUploadState(macEdit.id)?.status === 'error', 30_000)
      // Its next attempt fails at the add instead, a failure of another kind
      // than the first.
      let failAdd = true
      storage.beforeAdd = async (p) => {
        if (failAdd && p.includes(macEdit.id)) {
          failAdd = false
          throw new Error('simulated slab upload failure')
        }
      }
      pin.mockRestore()

      await phoneHasVersion(macEdit.id)
      expect(failAdd).toBe(false)
    })

    it('uploads it after its file could not be read, and shows it failed until then', async () => {
      const id = await createShared()
      // Every add the Mac makes from here is the edit's, and the phone shares
      // this storage, so its adds are told apart by the Mac's directory.
      const failing = { on: true, attempts: 0 }
      storage.beforeAdd = async (p) => {
        if (!failing.on || !p.startsWith(mac.tempDir)) return
        failing.attempts += 1
        throw new Error(`could not read ${p}`)
      }
      await mac.app.provider.write(id, stage('mac edit'))
      const [macEdit] = await mac.app.files.getVersionHistory('notes.txt', null)
      await mac.waitForCondition(() => failing.attempts > 0, 30_000)

      await phoneSavesOver(id, macEdit.id)
      // An attempt after the edit became an older version, which still fails
      // and still shows.
      const before = failing.attempts
      await mac.waitForCondition(() => failing.attempts > before, 30_000)
      await mac.waitForCondition(() => mac.getUploadState(macEdit.id)?.status === 'error', 30_000)
      // Longer than a poll interval, so the poll's check for failed files it
      // no longer takes has run.
      await new Promise((resolve) => setTimeout(resolve, 1500))
      expect(mac.getUploadState(macEdit.id)?.status).toBe('error')

      failing.on = false
      await phoneHasVersion(macEdit.id)
    })

    it('uploads it after the uploader restarts with its upload still failing', async () => {
      const id = await createShared()
      const pin = jest
        .spyOn(mac.sdk, 'pinObject')
        .mockRejectedValue(new Error('simulated network failure'))
      await mac.app.provider.write(id, stage('mac edit'))
      await mac.waitForCondition(() => pin.mock.calls.length > 0, 30_000)
      const [macEdit] = await mac.app.files.getVersionHistory('notes.txt', null)

      // What the daemon runs on exit. The failed attempt and its retry are
      // kept in memory only, so they go with it.
      await mac.app.uploader.shutdown()
      pin.mockRestore()
      await phoneSavesOver(id, macEdit.id)
      mac.internal.initUploader()

      await phoneHasVersion(macEdit.id)
      expect((await mac.readLocalObjectsForFile(macEdit.id)).length).toBeGreaterThan(0)
    })
  })
})
