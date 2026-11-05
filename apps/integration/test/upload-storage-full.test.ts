import * as nodeFs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { summarizeUploads } from '@siastorage/core/lib/uploadActivity'
import { createEmptyIndexerStorage, type MockIndexerStorage } from '@siastorage/sdk-mock'
import { createTestApp, generateTestFiles, type TestApp } from './app'

describe('Uploads while the account is full', () => {
  let storage: MockIndexerStorage
  let app: TestApp
  let handoff: string
  let staged = 0
  let added: string[]

  function stage(text: string): string {
    const file = path.join(handoff, `staged-${++staged}`)
    nodeFs.writeFileSync(file, text)
    return file
  }

  // The current version is the one with the newest version clock.
  async function newestVersion(name: string) {
    const versions = await app.app.files.getVersionHistory(name, null)
    return { versions, newest: versions.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a)) }
  }

  const summary = () => summarizeUploads(Object.values(app.app.uploads.getState().uploads))

  async function uploaded(fileId: string) {
    await app.waitForCondition(
      async () => (await app.readLocalObjectsForFile(fileId)).length > 0,
      30_000,
    )
  }

  beforeEach(async () => {
    storage = createEmptyIndexerStorage()
    added = []
    storage.beforeAdd = async (p) => {
      added.push(p)
    }
    handoff = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'storage-full-'))
    app = createTestApp(storage, { handoffDir: handoff })
  })

  afterEach(async () => {
    await app.shutdown()
    nodeFs.rmSync(handoff, { recursive: true, force: true })
  })

  it('holds a file enqueued directly while the account has no storage left, and uploads it once there is room', async () => {
    storage.remainingStorage = 0n
    await app.start()
    await app.waitForCondition(() => app.app.uploads.getState().storageFull)
    const [file] = await app.addFiles(generateTestFiles(1, { sizeBytes: 4096 }))
    expect(await app.app.uploader.enqueueByIds([file.id])).toEqual({ queued: 1, skipped: 0 })

    // Three of the integration setup's one-second storage checks.
    await new Promise((resolve) => setTimeout(resolve, 3000))
    expect(added).toEqual([])
    expect(app.getUploadState(file.id)?.status).toBe('queued')
    expect(app.app.uploads.getState().storageFull).toBe(true)

    storage.remainingStorage = 1_000_000n
    await uploaded(file.id)
    expect(app.app.uploads.getState().storageFull).toBe(false)
  })

  it('keeps holding a file enqueued while the account is full when a later account check fails', async () => {
    storage.remainingStorage = 0n
    await app.start()
    await app.waitForCondition(() => app.app.uploads.getState().storageFull)
    const check = jest.spyOn(app.sdk, 'account').mockRejectedValue(new Error('indexer unavailable'))
    const [file] = await app.addFiles(generateTestFiles(1, { sizeBytes: 4096 }))
    expect(await app.app.uploader.enqueueByIds([file.id])).toEqual({ queued: 1, skipped: 0 })

    // Three of the integration setup's one-second storage checks, each failing.
    await new Promise((resolve) => setTimeout(resolve, 3000))
    expect(check).toHaveBeenCalled()
    expect(added).toEqual([])
    expect(app.getUploadState(file.id)?.status).toBe('queued')

    check.mockRestore()
    storage.remainingStorage = 1_000_000n
    await uploaded(file.id)
  })

  it('uploads each Finder save made while the account is full once there is room', async () => {
    storage.remainingStorage = 0n
    await app.start()
    await app.waitForCondition(() => app.app.uploads.getState().storageFull)
    const created = await app.app.provider.create(null, 'notes.txt', 'file', stage('one'))
    await app.app.provider.write(created.id, stage('two'))
    await app.app.provider.write(created.id, stage('three'))
    const { versions } = await newestVersion('notes.txt')
    expect(added).toEqual([])

    // A replaced version's copy is freed only once it has uploaded, so each
    // one goes up rather than staying on disk for good.
    storage.remainingStorage = 1_000_000n
    for (const v of versions) await uploaded(v.id)
    expect(added).toHaveLength(3)
  })

  it('counts no failed file once a version that failed to upload is replaced', async () => {
    let failing = true
    storage.beforeAdd = async (p) => {
      if (failing) throw new Error(`could not read ${p}`)
    }
    await app.start()
    const created = await app.app.provider.create(null, 'notes.txt', 'file', stage('one'))
    await app.waitForCondition(() => app.getUploadState(created.id)?.status === 'error')
    expect(summary().failedFiles).toBe(1)

    failing = false
    await app.app.provider.write(created.id, stage('two'))
    const { newest } = await newestVersion('notes.txt')
    await uploaded(newest.id)

    await app.waitForCondition(() => summary().failedFiles === 0)
    expect(app.getUploadState(created.id)).toBeUndefined()
  })

  it('counts no failed file once another device saves a newer version over one that failed to upload', async () => {
    const other = createTestApp(storage, { handoffDir: handoff })
    storage.beforeAdd = async (p) => {
      if (p.startsWith(app.tempDir)) throw new Error(`could not read ${p}`)
    }
    await app.start()
    await other.start()
    try {
      const created = await app.app.provider.create(null, 'notes.txt', 'file', stage('mine'))
      await app.waitForCondition(() => app.getUploadState(created.id)?.status === 'error')

      await other.app.provider.create(null, 'notes.txt', 'file', stage('theirs'))
      await app.waitForCondition(async () => {
        const { newest } = await newestVersion('notes.txt')
        return newest.id !== created.id
      }, 30_000)

      await app.waitForCondition(() => summary().failedFiles === 0, 30_000)
      expect(app.getUploadState(created.id)).toBeUndefined()
    } finally {
      await other.shutdown()
    }
  })
})
