import * as crypto from 'node:crypto'
import * as nodeFs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createEmptyIndexerStorage, type MockIndexerStorage } from '@siastorage/sdk-mock'
import { toContentHash } from '@siastorage/core/lib/contentHash'
import { decodeFileMetadata } from '@siastorage/core/encoding/fileMetadata'
import { createTestApp } from './app'

/*
 * A Finder save deletes the version it replaces when that version never left
 * this Mac: it has no object on any indexer, no batch holds it, and no share
 * link names it. A version that did leave, and any version an import stacks
 * on, stays and uploads as usual.
 */
describe('A Finder save replacing a version that has not uploaded', () => {
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
    handoff = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'finder-replaced-saves-'))
    mac = createTestApp(storage, { handoffDir: handoff })
    phone = createTestApp(storage, { handoffDir: handoff })
    await mac.start()
    await phone.start()
  })

  afterEach(async () => {
    storage.beforeAdd = null
    await phone.shutdown()
    await mac.shutdown()
    nodeFs.rmSync(handoff, { recursive: true, force: true })
  })

  async function versionIds(app: typeof mac): Promise<string[]> {
    return (await app.app.files.getVersionHistory('notes.txt', null)).map((v) => v.id)
  }

  async function uploaded(id: string): Promise<boolean> {
    return (await mac.readLocalObjectsForFile(id)).length > 0
  }

  /** notes.txt created through Finder and uploaded. */
  async function createUploaded(): Promise<string> {
    const created = await mac.app.provider.create(null, 'notes.txt', 'file', stage('first'))
    await mac.waitForCondition(() => uploaded(created.id), 30_000)
    return created.id
  }

  it('uploads one version, not ten, for ten saves made while offline', async () => {
    const first = await createUploaded()
    mac.setConnected(false)

    for (let i = 1; i <= 10; i++) await mac.app.provider.write(first, stage(`edit ${i}`))

    const [last, ...older] = await versionIds(mac)
    expect(older).toEqual([first])
    expect(await mac.app.files.getUnuploadedCount()).toBe(1)
    const lastBytes = nodeFs.readFileSync(
      (await mac.app.fs.getFileUri((await mac.app.files.getById(last))!))!.replace('file://', ''),
      'utf8',
    )
    expect(lastBytes).toBe('edit 10')

    mac.setConnected(true)
    await mac.waitForCondition(() => uploaded(last), 30_000)
    await phone.waitForCondition(async () => (await versionIds(phone)).length === 2, 30_000)
    expect(await versionIds(phone)).toEqual([last, first])
    expect(storage.objects.size).toBe(2)
  }, 60_000)

  it('keeps a version a batch already holds, and uploads it', async () => {
    const first = await createUploaded()
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    storage.beforeAdd = () => held

    await mac.app.provider.write(first, stage('packed'))
    const [packed] = await versionIds(mac)
    await mac.waitForCondition(() => mac.getUploadState(packed)?.status === 'packing', 30_000)
    await mac.app.provider.write(first, stage('next'))
    release()

    const [next] = await versionIds(mac)
    await mac.waitForCondition(async () => (await uploaded(packed)) && uploaded(next), 30_000)
    expect(await versionIds(mac)).toEqual([next, packed, first])
  }, 60_000)

  it('keeps a version a share link names, and uploads it', async () => {
    const first = await createUploaded()
    // Its add fails, so it waits to retry, neither uploaded nor in a batch.
    let failing = true
    storage.beforeAdd = async () => {
      if (failing) throw new Error('simulated add failure')
    }
    await mac.app.provider.write(first, stage('shared'))
    const [shared] = await versionIds(mac)
    await mac.waitForCondition(() => mac.getUploadState(shared)?.status === 'error', 30_000)
    await mac.app.shares.createLink([shared], { expiresAt: null, mode: 'snapshot' })

    await mac.app.provider.write(first, stage('after the link'))
    failing = false

    const [next] = await versionIds(mac)
    await mac.waitForCondition(async () => (await uploaded(shared)) && uploaded(next), 30_000)
    expect(await versionIds(mac)).toEqual([next, shared, first])
  }, 60_000)

  /** The file ids a recipient of the link sees, from the metadata each object was attached with. */
  function attachedIds(publicKey: string): string[] {
    const key = storage.sharingKeys.get(publicKey)
    return key ? [...key.objects.values()].map((m) => decodeFileMetadata(m).id) : []
  }

  /** Holds every upload in the queue, unpacked, until `makeRoom` runs. */
  async function fillAccount(): Promise<() => void> {
    storage.remainingStorage = 0n
    await mac.waitForCondition(() => mac.app.uploads.getState().storageFull, 30_000)
    return () => {
      storage.remainingStorage = 1_000_000_000n
    }
  }

  it('shares the current version when the link is asked for with a version a save has since dropped', async () => {
    const first = await createUploaded()
    const makeRoom = await fillAccount()
    await mac.app.provider.write(first, stage('selected'))
    // The id Finder's Share Link resolves the selection to, before the user
    // picks a mode and the app saves again.
    const [selected] = await versionIds(mac)
    await mac.app.provider.write(first, stage('saved while the window was open'))
    const [current] = await versionIds(mac)
    expect(await versionIds(mac)).toEqual([current, first])

    const link = await mac.app.shares.createLink([selected], { expiresAt: null, mode: 'snapshot' })

    expect(link.files.map((f) => f.fileId)).toEqual([current])
    makeRoom()
    await mac.waitForCondition(() => uploaded(current), 30_000)
    await mac.waitForCondition(async () => {
      await mac.app.shares.syncLinks()
      return attachedIds(link.publicKey).join() === current
    }, 30_000)
  }, 60_000)

  it('shares the renamed file, not a new file at its old name, for a version a save dropped', async () => {
    const first = await createUploaded()
    const makeRoom = await fillAccount()
    await mac.app.provider.write(first, stage('selected'))
    const [selected] = await versionIds(mac)
    await mac.app.provider.write(first, stage('saved while the window was open'))
    const [current] = await versionIds(mac)
    await mac.app.files.renameFile(current, 'renamed.txt')
    const other = await mac.app.provider.create(null, 'notes.txt', 'file', stage('another file'))

    const link = await mac.app.shares.createLink([selected], { expiresAt: null, mode: 'snapshot' })

    expect(link.files.map((f) => f.fileId)).toEqual([current])
    expect(link.files.map((f) => f.fileId)).not.toContain(other.id)
    makeRoom()
  }, 60_000)

  it('uploads a version a share link keeps with auto-scan uploads off', async () => {
    await mac.app.settings.setAutoScanUploads(false)
    const first = await createUploaded()
    const makeRoom = await fillAccount()
    await mac.app.provider.write(first, stage('shared'))
    const [shared] = await versionIds(mac)
    await mac.app.shares.createLink([shared], { expiresAt: null, mode: 'snapshot' })

    await mac.app.provider.write(first, stage('after the link'))
    const [next] = await versionIds(mac)
    expect(mac.getUploadState(shared)?.status).toBe('queued')
    makeRoom()

    await mac.waitForCondition(async () => (await uploaded(shared)) && uploaded(next), 30_000)
    expect(await versionIds(mac)).toEqual([next, shared, first])
  }, 60_000)

  it('keeps a version an import stacks a same-name file on', async () => {
    mac.setConnected(false)
    for (const [id, text] of [
      ['import-1', 'one'],
      ['import-2', 'two'],
    ]) {
      await mac.addFiles([
        (tempDir) => {
          const file = path.join(tempDir, `${id}.txt`)
          nodeFs.writeFileSync(file, text)
          return {
            id,
            name: 'notes.txt',
            type: 'text/plain',
            size: text.length,
            hash: toContentHash(crypto.createHash('sha256').update(text).digest('hex')),
            uri: `file://${file}`,
          }
        },
      ])
    }

    expect(await versionIds(mac)).toEqual(['import-2', 'import-1'])
    expect(await mac.app.files.getUnuploadedCount()).toBe(2)
  }, 60_000)
})
