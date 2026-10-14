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
