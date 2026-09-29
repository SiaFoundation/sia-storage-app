import type { AppService, AppServiceInternal } from '../app/service'
import { PACKER_IDLE_TIMEOUT } from '../config'
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
  manager.initialize(held.app, {} as AppServiceInternal, { toFilePath: (uri) => uri })
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
