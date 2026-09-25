/*
 * A folder of files dragged into Finder while the library is busy syncing.
 * The system hands each file to the provider as its own call, all at once,
 * and every one of them shares the database with sync-down's transactions.
 * None may fail, and none may vanish after reporting success.
 */
import * as nodeFs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createEmptyIndexerStorage, type MockIndexerStorage } from '@siastorage/sdk-mock'
import { createTestApp, type TestApp } from './app'
import { assertFeedConverges, waitForCondition } from './utils'

const DRAGGED = 200
const PUBLISHED = 300

describe('Dragging many files into the provider during sync', () => {
  let shared: MockIndexerStorage
  let A: TestApp
  let B: TestApp
  let handoff: string

  beforeEach(async () => {
    shared = createEmptyIndexerStorage()
    handoff = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'provider-bulk-'))
    A = createTestApp(shared, { handoffDir: handoff })
    B = createTestApp(shared)
    await A.start()
    await B.start()
  })

  afterEach(async () => {
    await A.shutdown()
    await B.shutdown()
    nodeFs.rmSync(handoff, { recursive: true, force: true })
  })

  it('keeps every file, uploads it and hands it to the other device', async () => {
    const existing = await A.app.provider.create(null, 'existing.txt', 'file', stage('existing'))
    const doomed = await A.app.provider.create(null, 'doomed.txt', 'file', stage('doomed'))
    // Another device's library, so A has a sync-down batch to apply. Its first
    // sync-down transaction is held open while the drag starts and for 100ms
    // after, so the creates arrive while it is open rather than whenever the
    // 200ms sync interval happens to fire.
    const now = Date.now()
    for (let i = 0; i < PUBLISHED; i++) {
      B.sdk.injectObject({
        metadata: {
          id: `published-${i}`,
          name: `published-${i}.txt`,
          type: 'text/plain',
          kind: 'file',
          size: 64,
          hash: `sha256:hash-${i}` as const,
          createdAt: now,
          updatedAt: now,
          trashedAt: null,
        },
      })
    }
    let syncOpen!: () => void
    const syncing = new Promise<void>((resolve) => {
      syncOpen = resolve
    })
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    let held = false
    const withTransaction = A.internal.withTransaction
    A.internal.withTransaction = (fn) =>
      withTransaction(async (tx) => {
        if (!held) {
          held = true
          syncOpen()
          await released
        }
        await fn(tx)
      })
    await syncing

    const dragged = Promise.allSettled([
      ...Array.from({ length: DRAGGED }, (_, i) =>
        A.app.provider.create(null, `dragged-${i}.txt`, 'file', stage(`dragged ${i}`)),
      ),
      A.app.provider.rename(existing.id, null, 'renamed.txt'),
      A.app.provider.trash(doomed.id),
    ])
    setTimeout(release, 100)
    const results = await dragged

    const failures = results.flatMap((r) => (r.status === 'rejected' ? [String(r.reason)] : []))
    expect(failures).toEqual([])
    const names = (await A.app.files.query({ order: 'ASC' })).map((f) => f.name)
    expect(names.filter((n) => n.startsWith('dragged-'))).toHaveLength(DRAGGED)
    expect(names).toContain('renamed.txt')
    expect(names).not.toContain('doomed.txt')

    await waitForCondition(
      async () => (await B.app.files.queryCount({ order: 'ASC' })) === PUBLISHED + DRAGGED + 1,
      {
        timeout: 60_000,
        message: 'B to receive every dragged file',
      },
    )
    await waitForCondition(
      async () => (await A.app.files.queryCount({ order: 'ASC' })) === PUBLISHED + DRAGGED + 1,
      {
        timeout: 60_000,
        message: 'A to receive every published file',
      },
    )
    await assertFeedConverges(A)
  }, 120_000)

  let staged = 0
  function stage(text: string): string {
    const file = path.join(handoff, `staged-${++staged}`)
    nodeFs.writeFileSync(file, text)
    return file
  }
})
