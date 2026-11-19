import type { AppService, AppServiceInternal } from '../app/service'
import { PACKER_IDLE_TIMEOUT, UPLOAD_YIELD_POLL_MS } from '../config'
import { TransferMemoryBudget } from './transferMemoryBudget'
import { UploadManager } from './uploader'

/**
 * An app stub whose poll holds on the auto-scan setting until the test
 * releases it. While it holds, the loop is inside pollDB with no idle wait
 * open, so wake() has nothing to resolve. Releasing it with false makes the
 * poll find nothing, and the loop goes straight to its idle wait.
 */
function createHeldPollApp() {
  const releases: Array<(autoScan: boolean) => void> = []
  const getAutoScanUploads = jest.fn(
    () =>
      new Promise<boolean>((resolve) => {
        releases.push(resolve)
      }),
  )
  const app = {
    settings: {
      getUploadSpeedStats: jest.fn().mockResolvedValue(null),
      setUploadSpeedStats: jest.fn().mockResolvedValue(undefined),
      getAutoScanUploads,
    },
    sync: { getState: () => ({ syncGateStatus: 'idle' }) },
    connection: { getState: () => ({ isConnected: true }) },
    account: jest.fn().mockResolvedValue({ remainingStorage: 1_000_000n }),
    // Every file the loop is handed counts as still queued.
    uploads: {
      getEntry: (id: string) => ({ id, status: 'queued' }),
      getState: () => ({ uploads: {}, storageFull: false }),
      setStorageFull: () => {},
    },
  } as unknown as AppService
  const releasePoll = (autoScan: boolean) => releases.shift()!(autoScan)
  return { app, getAutoScanUploads, releasePoll }
}

async function startHeldInPoll() {
  const held = createHeldPollApp()
  const manager = new UploadManager()
  const internal = {
    transferBudget: new TransferMemoryBudget(() => null),
  } as unknown as AppServiceInternal
  manager.initialize(held.app, internal, { toFilePath: (uri) => uri })
  await jest.advanceTimersByTimeAsync(0)
  expect(held.getAutoScanUploads).toHaveBeenCalledTimes(1)
  return { manager, ...held }
}

describe('UploadManager idle wait', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('exits with no pending timer when shutdown lands during a poll', async () => {
    const { manager, getAutoScanUploads, releasePoll } = await startHeldInPoll()

    await manager.shutdown()
    releasePoll(false)
    await jest.advanceTimersByTimeAsync(0)

    expect(jest.getTimerCount()).toBe(0)
    await jest.advanceTimersByTimeAsync(60_000)
    expect(getAutoScanUploads).toHaveBeenCalledTimes(1)
  })

  it('parks with no pending timer when suspend lands during a poll, and polls again on resume', async () => {
    const { manager, getAutoScanUploads, releasePoll } = await startHeldInPoll()

    await manager.suspend()
    releasePoll(false)
    await jest.advanceTimersByTimeAsync(0)

    expect(jest.getTimerCount()).toBe(0)
    await jest.advanceTimersByTimeAsync(60_000)
    expect(getAutoScanUploads).toHaveBeenCalledTimes(1)

    manager.resume()
    await jest.advanceTimersByTimeAsync(0)
    expect(getAutoScanUploads).toHaveBeenCalledTimes(2)

    await manager.shutdown()
    releasePoll(false)
    await jest.advanceTimersByTimeAsync(0)
    expect(jest.getTimerCount()).toBe(0)
  })

  it('does not flush an open batch when suspend lands during the poll before an idle flush', async () => {
    const { manager, releasePoll } = await startHeldInPoll()
    const internals = manager as unknown as {
      batch: unknown
      flush: (reason: string) => Promise<void>
    }
    const flush = jest.spyOn(internals, 'flush').mockResolvedValue(undefined)
    internals.batch = { batchId: 'open' }

    releasePoll(false)
    await jest.advanceTimersByTimeAsync(PACKER_IDLE_TIMEOUT)
    await manager.suspend()
    releasePoll(false)
    await jest.advanceTimersByTimeAsync(0)

    expect(flush).not.toHaveBeenCalled()
    internals.batch = null
    await manager.shutdown()
  })
})

describe('UploadManager poll and held saves', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('does not register a save that was held while the poll queried the database', async () => {
    const queries: Array<(files: unknown[]) => void> = []
    const registerMany = jest.fn()
    const version = { id: 'v2', kind: 'file', size: 10, thumbForId: null }
    const thumbnail = { id: 't2', kind: 'thumb', size: 1, thumbForId: 'v2' }
    const app = {
      settings: {
        getUploadSpeedStats: jest.fn().mockResolvedValue(null),
        setUploadSpeedStats: jest.fn().mockResolvedValue(undefined),
        getAutoScanUploads: jest.fn().mockResolvedValue(true),
        getIndexerURL: jest.fn().mockResolvedValue('https://idx.example.com'),
      },
      sync: { getState: () => ({ syncGateStatus: 'idle' }) },
      connection: { getState: () => ({ isConnected: true }) },
      account: jest.fn().mockResolvedValue({ remainingStorage: 1_000_000n }),
      files: {
        query: jest.fn(() => new Promise<unknown[]>((resolve) => queries.push(resolve))),
        getByIds: jest.fn().mockResolvedValue([]),
      },
      fs: { getFileUri: jest.fn(async (f: { id: string }) => `file:///${f.id}`) },
      uploads: {
        getActiveIds: () => [],
        getEntry: (id: string) => ({ id, status: 'queued' }),
        getState: () => ({ uploads: {}, storageFull: false }),
        setStorageFull: () => {},
        registerMany,
      },
    } as unknown as AppService
    const manager = new UploadManager()
    const internal = {
      transferBudget: new TransferMemoryBudget(() => null),
    } as unknown as AppServiceInternal
    // The first save of a file is not held, so the second one is.
    expect(manager.holdSave('stack', 'v1')).toBe(false)
    manager.initialize(app, internal, { toFilePath: (uri) => uri })
    await jest.advanceTimersByTimeAsync(0)
    expect(queries).toHaveLength(1)

    expect(manager.holdSave('stack', 'v2')).toBe(true)
    queries.shift()!([version, thumbnail])
    await jest.advanceTimersByTimeAsync(0)

    expect(registerMany).not.toHaveBeenCalled()
    await manager.shutdown()
    queries.shift()?.([])
    await jest.advanceTimersByTimeAsync(0)
  })
})

describe('UploadManager and the memory budget', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('adds no file while a download the user opened needs the room, and carries on once it ends', async () => {
    const MB = 1024 * 1024
    // 200 MiB cannot hold a one-slab upload beside the 64 MiB download floor.
    const budget = new TransferMemoryBudget(() => ({
      availableBytes: 1200 * MB,
      thresholdBytes: 400 * MB,
      lowMemory: false,
    }))
    const held = createHeldPollApp()
    const manager = new UploadManager()
    manager.initialize(held.app, { transferBudget: budget } as unknown as AppServiceInternal, {
      toFilePath: (uri) => uri,
    })
    await jest.advanceTimersByTimeAsync(0)
    const internals = manager as unknown as {
      loopGeneration: number
      processEntry: (entry: { fileId: string }) => Promise<void>
      processEntries: (entries: unknown[], generation: number) => Promise<void>
    }
    const added: string[] = []
    jest.spyOn(internals, 'processEntry').mockImplementation(async (entry) => {
      added.push(entry.fileId)
    })

    const opened = budget.reserveDownload({ user: true })
    const run = internals.processEntries(
      [
        { fileId: 'a', size: 1 },
        { fileId: 'b', size: 1 },
      ],
      internals.loopGeneration,
    )
    await jest.advanceTimersByTimeAsync(10 * UPLOAD_YIELD_POLL_MS)
    expect(added).toEqual([])

    opened.release()
    await jest.advanceTimersByTimeAsync(UPLOAD_YIELD_POLL_MS)
    await run
    expect(added).toEqual(['a', 'b'])

    await manager.shutdown()
    held.releasePoll(false)
    await jest.advanceTimersByTimeAsync(0)
  })
})

describe('UploadManager.withdraw', () => {
  /** A manager whose uploads store holds one entry per status, and no loop running. */
  function managerWithEntries() {
    const statuses = ['queued', 'error', 'packing', 'packed', 'uploading', 'done'] as const
    const entries = new Map<string, { id: string; status: string }>(
      statuses.map((status) => [status, { id: status, status }]),
    )
    const manager = new UploadManager()
    ;(manager as unknown as { app: AppService }).app = {
      uploads: {
        getEntry: (id: string) => entries.get(id),
        remove: (id: string) => entries.delete(id),
      },
    } as unknown as AppService
    return { manager, entries }
  }

  it('takes a queued file, or one waiting to retry, out of the uploads store', () => {
    const { manager, entries } = managerWithEntries()

    expect(manager.withdraw('queued')).toBe('withdrawn')
    expect(manager.withdraw('error')).toBe('withdrawn')
    expect(entries.has('queued')).toBe(false)
    expect(entries.has('error')).toBe(false)
  })

  it('leaves a file a batch holds, and says it did', () => {
    const { manager, entries } = managerWithEntries()

    for (const status of ['packing', 'packed', 'uploading', 'done']) {
      expect(manager.withdraw(status)).toBe('held')
      expect(entries.get(status)?.status).toBe(status)
    }
  })

  it('reports a file the uploader does not hold as absent', () => {
    const { manager } = managerWithEntries()

    expect(manager.withdraw('never-queued')).toBe('absent')
  })

  it('takes back a Finder save held for a repeat save, which has no uploads-store entry', () => {
    jest.useFakeTimers()
    try {
      const { manager } = managerWithEntries()
      // The first save of a file is not held, so the second one is.
      expect(manager.holdSave('stack', 'v1')).toBe(false)
      expect(manager.holdSave('stack', 'v2')).toBe(true)

      expect(manager.withdraw('v2')).toBe('withdrawn')
      expect(manager.withdraw('v2')).toBe('absent')
    } finally {
      jest.useRealTimers()
    }
  })

  it('packs a file withdrawn and enqueued again once, though both entries are still queued', async () => {
    const entries = new Map<string, { id: string; status: string }>()
    const app = {
      uploads: {
        getEntry: (id: string) => entries.get(id),
        getActiveIds: () => [...entries.keys()],
        registerMany: (files: { id: string }[]) => {
          for (const f of files) entries.set(f.id, { id: f.id, status: 'queued' })
        },
        remove: (id: string) => entries.delete(id),
        setStatus: (id: string, status: string) => {
          const entry = entries.get(id)
          if (entry) entry.status = status
        },
      },
    } as unknown as AppService
    const addPath = jest.fn().mockResolvedValue(undefined)
    const internal = {
      transferBudget: new TransferMemoryBudget(() => null),
      requireSdk: () => ({ uploadPacked: async () => ({ addPath, cancel: () => {} }) }),
    } as unknown as AppServiceInternal
    // Wired by hand rather than by initialize(), so no loop runs until the
    // test drains the queue itself.
    const manager = new UploadManager()
    const internals = manager as unknown as {
      app: AppService
      internal: AppServiceInternal
      adapters: { toFilePath: (uri: string) => string }
      active: boolean
      loopGeneration: number
      explicitQueue: { fileId: string }[]
      drainQueues: (first: unknown) => unknown[]
      processEntries: (entries: unknown[], generation: number) => Promise<void>
    }
    internals.app = app
    internals.internal = internal
    internals.adapters = { toFilePath: (uri) => uri }
    internals.active = true
    internals.loopGeneration = 1
    const entry = {
      fileId: 'v1',
      fileUri: 'file:///v1',
      size: 10,
      file: { id: 'v1', kind: 'file' } as never,
    }

    expect(manager.enqueue([entry])).toBe(1)
    expect(manager.withdraw('v1')).toBe('withdrawn')
    expect(manager.enqueue([{ ...entry }])).toBe(1)
    expect(internals.explicitQueue).toHaveLength(2)

    const first = internals.explicitQueue.shift()
    await internals.processEntries(internals.drainQueues(first), 1)

    expect(addPath).toHaveBeenCalledTimes(1)
    expect(entries.get('v1')?.status).toBe('packed')
    internals.active = false
  })
})
