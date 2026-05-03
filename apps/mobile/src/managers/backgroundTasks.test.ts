import BackgroundFetch from 'react-native-background-fetch'
import { isBgTaskActive } from './bgTaskContext'
import { initBackgroundTasks } from './backgroundTasks'

// Capture the callbacks passed to BackgroundFetch.configure so we can simulate OS behavior
let taskCallback: (taskId: string) => Promise<void>
let timeoutCallback: (taskId: string) => void

jest.mock('react-native-background-fetch', () => ({
  __esModule: true,
  default: {
    configure: jest.fn((_config, onTask, onTimeout) => {
      taskCallback = onTask
      timeoutCallback = onTimeout
      return Promise.resolve(0)
    }),
    scheduleTask: jest.fn(() => Promise.resolve(true)),
    finish: jest.fn(),
    NETWORK_TYPE_UNMETERED: 2,
  },
}))

// Mock delayWithSignal so tests can control when a delay resolves.
type PendingDelay = {
  resolve: () => void
  signal: AbortSignal
  onAbort: () => void
}
const mockPendingDelays: PendingDelay[] = []

function mockRemovePending(entry: PendingDelay) {
  const idx = mockPendingDelays.indexOf(entry)
  if (idx >= 0) mockPendingDelays.splice(idx, 1)
}

jest.mock('../lib/delayWithSignal', () => ({
  delayWithSignal: (_ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const makeAbortError = () => {
        const err = new Error('Aborted')
        err.name = 'AbortError'
        return err
      }
      if (signal.aborted) {
        reject(makeAbortError())
        return
      }
      const entry: PendingDelay = {
        resolve: () => {},
        signal,
        onAbort: () => {},
      }
      entry.resolve = () => {
        signal.removeEventListener('abort', entry.onAbort)
        mockRemovePending(entry)
        resolve()
      }
      entry.onAbort = () => {
        mockRemovePending(entry)
        reject(makeAbortError())
      }
      signal.addEventListener('abort', entry.onAbort, { once: true })
      mockPendingDelays.push(entry)
    }),
}))

const mockGetFileStatsLocal = jest.fn()
jest.mock('../stores/files', () => ({
  getFileStatsLocal: (...args: unknown[]) => mockGetFileStatsLocal(...args),
}))

jest.mock('../stores/sdk', () => ({}))

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: { currentState: 'background' },
}))

jest.mock('../stores/appService', () => ({
  app: jest.fn(() => ({
    init: {
      getState: () => ({
        isInitializing: false,
        initializationError: null,
        steps: {},
      }),
    },
    settings: {
      getHasOnboarded: jest.fn(() => true),
    },
    connection: {
      getState: () => ({ isConnected: true }),
    },
  })),
}))

const mockRunFsEvictionScanner = jest.fn(() => Promise.resolve(undefined))
jest.mock('./fsEvictionScanner', () => ({
  runFsEvictionScanner: () => mockRunFsEvictionScanner(),
}))

jest.mock('./uploader', () => ({
  getUploadManager: jest.fn(() => ({
    packedCount: 0,
    packedBytes: 0,
    uploadedCount: 0,
    uploadedBytes: 0,
  })),
}))

const mockRegister = jest.fn((_id: string) => Promise.resolve())
const mockRelease = jest.fn((_id: string) => Promise.resolve())
jest.mock('./suspension', () => ({
  registerBackgroundTaskLifecycle: (id: string) => mockRegister(id),
  releaseBackgroundTaskLifecycle: (id: string) => mockRelease(id),
}))

const flushPromises = () => new Promise(setImmediate)

function completeNextDelay() {
  const entry = mockPendingDelays[0]
  if (entry) {
    entry.resolve()
  }
}

function getPendingDelayCount() {
  return mockPendingDelays.length
}

function clearPendingDelays() {
  mockPendingDelays.length = 0
}

describe('backgroundTasks', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    clearPendingDelays()
    mockGetFileStatsLocal.mockReset()
    mockRunFsEvictionScanner.mockReset().mockResolvedValue(undefined)
    mockRegister.mockReset().mockResolvedValue(undefined)
    mockRelease.mockReset().mockResolvedValue(undefined)

    await initBackgroundTasks()
  })

  describe('suspension lifecycle', () => {
    it('registers lifecycle at task start', async () => {
      mockGetFileStatsLocal.mockResolvedValue({ count: 0, totalBytes: 0 })

      await taskCallback('com.transistorsoft.fetch')

      expect(mockRegister).toHaveBeenCalledTimes(1)
      expect(mockRegister).toHaveBeenCalledWith('com.transistorsoft.fetch')
    })

    it('releases lifecycle on normal completion', async () => {
      mockGetFileStatsLocal.mockResolvedValue({ count: 0, totalBytes: 0 })

      await taskCallback('com.transistorsoft.fetch')

      expect(mockRelease).toHaveBeenCalledWith('com.transistorsoft.fetch')
    })

    it('releases lifecycle on timeout', async () => {
      mockGetFileStatsLocal.mockResolvedValue({ count: 100, totalBytes: 100000 })

      const taskPromise = taskCallback('com.transistorsoft.fetch')
      await flushPromises()

      timeoutCallback('com.transistorsoft.fetch')
      await flushPromises()
      await flushPromises()
      await taskPromise

      expect(mockRelease).toHaveBeenCalledWith('com.transistorsoft.fetch')
    })

    it('releases lifecycle even when work throws', async () => {
      mockGetFileStatsLocal.mockRejectedValue(new Error('simulated db error'))

      await taskCallback('com.transistorsoft.fetch')

      expect(mockRelease).toHaveBeenCalledWith('com.transistorsoft.fetch')
    })

    it('awaits lifecycle release before BackgroundFetch.finish on normal path', async () => {
      // Release runs the gate / interrupt-loop / drain so finish() lands
      // once SQLite locks are released. The BG-task assertion stays held
      // only as long as the drain genuinely has work to wait on. Fixes
      // 0xDEAD10CC.
      mockGetFileStatsLocal.mockResolvedValue({ count: 0, totalBytes: 0 })
      const order: string[] = []
      const finishMock = BackgroundFetch.finish as jest.MockedFunction<
        typeof BackgroundFetch.finish
      >
      finishMock.mockImplementation((id) => {
        order.push(`finish:${id}`)
      })
      mockRelease.mockImplementation(async (id) => {
        order.push(`release:${id}`)
      })

      await taskCallback('com.transistorsoft.fetch')

      expect(order).toEqual(['release:com.transistorsoft.fetch', 'finish:com.transistorsoft.fetch'])
    })

    it('awaits lifecycle release before BackgroundFetch.finish on timeout path', async () => {
      mockGetFileStatsLocal.mockResolvedValue({ count: 100, totalBytes: 100000 })
      const order: string[] = []
      const finishMock = BackgroundFetch.finish as jest.MockedFunction<
        typeof BackgroundFetch.finish
      >
      finishMock.mockImplementation((id) => {
        order.push(`finish:${id}`)
      })
      mockRelease.mockImplementation(async (id) => {
        order.push(`release:${id}`)
      })

      const taskPromise = taskCallback('com.transistorsoft.fetch')
      await flushPromises()

      const timeoutPromise = Promise.resolve(timeoutCallback('com.transistorsoft.fetch'))
      await flushPromises()
      await flushPromises()
      await timeoutPromise
      await taskPromise

      const finishIdx = order.indexOf('finish:com.transistorsoft.fetch')
      const releaseIdx = order.indexOf('release:com.transistorsoft.fetch')
      expect(finishIdx).toBeGreaterThanOrEqual(0)
      expect(releaseIdx).toBeGreaterThanOrEqual(0)
      expect(releaseIdx).toBeLessThan(finishIdx)
    })

    it('does not double-call finish/release when timeout fires mid-work', async () => {
      // Race the timeout against the normal callback. Both must converge
      // on exactly one finish + one release for the same invocation.
      mockGetFileStatsLocal.mockResolvedValue({ count: 100, totalBytes: 100000 })

      const taskPromise = taskCallback('com.transistorsoft.fetch')
      await flushPromises()

      timeoutCallback('com.transistorsoft.fetch')
      await flushPromises()
      await flushPromises()
      await taskPromise

      expect(BackgroundFetch.finish).toHaveBeenCalledWith('com.transistorsoft.fetch')
      expect(
        (BackgroundFetch.finish as jest.MockedFunction<typeof BackgroundFetch.finish>).mock.calls
          .length,
      ).toBe(1)
      expect(mockRelease).toHaveBeenCalledTimes(1)
    })

    it('treats a late timeout as a no-op when normal already finalized', async () => {
      mockGetFileStatsLocal.mockResolvedValue({ count: 0, totalBytes: 0 })

      await taskCallback('com.transistorsoft.fetch')
      expect(BackgroundFetch.finish).toHaveBeenCalledTimes(1)

      // Stray expirationHandler firing after we already completed.
      timeoutCallback('com.transistorsoft.fetch')

      expect(BackgroundFetch.finish).toHaveBeenCalledTimes(1)
      expect(mockRelease).toHaveBeenCalledTimes(1)
    })
  })

  describe('active BG task tracking', () => {
    it.each([
      ['com.transistorsoft.fetch', 'BGAppRefreshTask'],
      ['com.transistorsoft.processing', 'BGProcessingTask'],
    ] as const)('marks %s as active during the task and clears on exit', async (taskId, type) => {
      let observed = false
      mockGetFileStatsLocal.mockImplementation(async () => {
        observed = isBgTaskActive(type)
        return { count: 0, totalBytes: 0 }
      })

      await taskCallback(taskId)

      expect(observed).toBe(true)
      expect(isBgTaskActive(type)).toBe(false)
    })

    it('does not stomp fetch active state when a processing task overlaps', async () => {
      // Cross-type overlap could happen if iOS schedules a processing
      // task while a fetch task is still mid-flight. Each must stay
      // independently tracked so finishing one doesn't clear the other.
      mockGetFileStatsLocal.mockResolvedValue({ count: 100, totalBytes: 100000 })

      const fetchTask = taskCallback('com.transistorsoft.fetch')
      await flushPromises()
      const processingTask = taskCallback('com.transistorsoft.processing')
      await flushPromises()
      expect(isBgTaskActive('BGAppRefreshTask')).toBe(true)
      expect(isBgTaskActive('BGProcessingTask')).toBe(true)

      timeoutCallback('com.transistorsoft.processing')
      await processingTask
      expect(isBgTaskActive('BGAppRefreshTask')).toBe(true)
      expect(isBgTaskActive('BGProcessingTask')).toBe(false)

      timeoutCallback('com.transistorsoft.fetch')
      await fetchTask
      expect(isBgTaskActive('BGAppRefreshTask')).toBe(false)
    })
  })

  describe('polling loop behavior', () => {
    it('exits immediately when no files are pending upload', async () => {
      mockGetFileStatsLocal.mockResolvedValue({ count: 0, totalBytes: 0 })

      await taskCallback('com.transistorsoft.fetch')

      // Code calls getFileStatsLocal for: initial stats + first loop check.
      expect(mockGetFileStatsLocal).toHaveBeenCalledWith({ localOnly: true })
      expect(mockGetFileStatsLocal).toHaveBeenCalledTimes(2)
      expect(getPendingDelayCount()).toBe(0)
    })

    it('polls repeatedly while files are pending, exits when uploads complete', async () => {
      mockGetFileStatsLocal
        .mockResolvedValueOnce({ count: 5, totalBytes: 5000 }) // initial stats
        .mockResolvedValueOnce({ count: 5, totalBytes: 5000 }) // first loop check -> delay
        .mockResolvedValueOnce({ count: 2, totalBytes: 2000 }) // second loop check -> delay
        .mockResolvedValueOnce({ count: 0, totalBytes: 0 }) // third loop check -> exit

      const taskPromise = taskCallback('com.transistorsoft.fetch')

      await flushPromises()
      expect(getPendingDelayCount()).toBe(1)

      completeNextDelay()
      await flushPromises()
      expect(getPendingDelayCount()).toBe(1)

      completeNextDelay()
      await flushPromises()

      await taskPromise

      expect(getPendingDelayCount()).toBe(0)
      // 1 initial stats + 3 loop iterations = 4 total calls
      expect(mockGetFileStatsLocal).toHaveBeenCalledTimes(4)
    })
  })

  describe('abort / timeout flow', () => {
    it('timeout aborts the controller, loop exits via sticky signal', async () => {
      mockGetFileStatsLocal.mockResolvedValue({ count: 100, totalBytes: 100000 })

      const taskPromise = taskCallback('com.transistorsoft.fetch')
      await flushPromises()
      expect(getPendingDelayCount()).toBe(1)

      timeoutCallback('com.transistorsoft.fetch')

      // Signal is now aborted, sticky. The in-flight delay rejects with
      // AbortError, loop catches and breaks.
      await taskPromise
      expect(getPendingDelayCount()).toBe(0)
    })

    it('timeout between delays still breaks the loop because signal.aborted is sticky', async () => {
      // This is the key structural win over the previous createBackgroundDelay:
      // if timeout fires while we're NOT inside delayWithSignal (between
      // iterations), the signal is still observed at the next check.
      mockGetFileStatsLocal
        .mockResolvedValueOnce({ count: 10, totalBytes: 10_000 }) // initial
        .mockResolvedValueOnce({ count: 10, totalBytes: 10_000 }) // first loop check
        .mockImplementation(async () => {
          // On the second loop iteration, fire timeout mid-stats-query.
          // By the time getFileStatsLocal resolves, signal is already
          // aborted.
          timeoutCallback('com.transistorsoft.fetch')
          return { count: 10, totalBytes: 10_000 }
        })

      const taskPromise = taskCallback('com.transistorsoft.fetch')

      await flushPromises()
      expect(getPendingDelayCount()).toBe(1)

      // Complete the first delay naturally. The next iteration will
      // call getFileStatsLocal which fires timeout synchronously inside.
      completeNextDelay()

      await taskPromise
    })
  })

  describe('task re-invocation handling', () => {
    it('new task invocation aborts previous controller', async () => {
      mockGetFileStatsLocal.mockResolvedValue({ count: 100, totalBytes: 100000 })

      const task1 = taskCallback('com.transistorsoft.fetch')
      await flushPromises()
      expect(getPendingDelayCount()).toBe(1)

      // OS re-triggers the task before the first completes.
      const task2 = taskCallback('com.transistorsoft.fetch')
      await flushPromises()

      // Clean up — timeout the active task.
      timeoutCallback('com.transistorsoft.fetch')
      await Promise.all([task1, task2])
    })

    it('each task invocation has an isolated AbortController', async () => {
      mockGetFileStatsLocal.mockResolvedValue({ count: 10, totalBytes: 10000 })

      const fetchTask = taskCallback('com.transistorsoft.fetch')
      await flushPromises()

      const processingTask = taskCallback('com.transistorsoft.processing')
      await flushPromises()

      // fetch parks one delay (upload poll). processing parks two: the
      // upload poll and the deferred-scan settle delay.
      expect(getPendingDelayCount()).toBe(3)

      // Timeout only affects its own task.
      timeoutCallback('com.transistorsoft.fetch')
      await fetchTask

      expect(getPendingDelayCount()).toBe(2)

      timeoutCallback('com.transistorsoft.processing')
      await processingTask
    })
  })

  describe('scanners', () => {
    it('skips fsEvictionScanner inside BGAppRefreshTask budget', async () => {
      mockGetFileStatsLocal.mockResolvedValue({ count: 0, totalBytes: 0 })

      await taskCallback('com.transistorsoft.fetch')

      expect(mockRunFsEvictionScanner).not.toHaveBeenCalled()
    })

    it('runs fsEvictionScanner after settle delay in BGProcessingTask', async () => {
      mockGetFileStatsLocal.mockResolvedValue({ count: 0, totalBytes: 0 })

      const taskPromise = taskCallback('com.transistorsoft.processing')
      await flushPromises()

      expect(mockRunFsEvictionScanner).not.toHaveBeenCalled()
      expect(getPendingDelayCount()).toBeGreaterThanOrEqual(1)

      mockPendingDelays[0].resolve()
      await taskPromise

      expect(mockRunFsEvictionScanner).toHaveBeenCalledTimes(1)
    })

    it('cancels the settle delay when BG task aborts before it fires', async () => {
      mockGetFileStatsLocal.mockResolvedValue({ count: 1, totalBytes: 100 })

      const taskPromise = taskCallback('com.transistorsoft.processing')
      await flushPromises()
      expect(getPendingDelayCount()).toBeGreaterThanOrEqual(1)

      timeoutCallback('com.transistorsoft.processing')
      await taskPromise

      expect(mockRunFsEvictionScanner).not.toHaveBeenCalled()
    })
  })

  describe('edge cases', () => {
    it('handles unknown task ID gracefully', async () => {
      await taskCallback('unknown-task-id')

      expect(BackgroundFetch.finish).toHaveBeenCalledWith('unknown-task-id')
      expect(mockGetFileStatsLocal).not.toHaveBeenCalled()
      expect(mockRegister).not.toHaveBeenCalled()
      expect(mockRelease).not.toHaveBeenCalled()
    })

    it('timeout for unknown task ID does not throw', () => {
      timeoutCallback('unknown-task-id')

      expect(BackgroundFetch.finish).toHaveBeenCalledWith('unknown-task-id')
    })
  })

  describe('task constraints', () => {
    it('schedules BGProcessingTask with charging + network constraints', () => {
      expect(BackgroundFetch.scheduleTask).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'com.transistorsoft.processing',
          requiresCharging: true,
          requiresNetworkConnectivity: true,
          requiresBatteryNotLow: true,
        }),
      )
    })

    it('configures BGAppRefreshTask with charging + network + battery constraints', () => {
      const configureMock = BackgroundFetch.configure as jest.MockedFunction<
        typeof BackgroundFetch.configure
      >
      const [config] = configureMock.mock.calls[0]
      expect(config).toMatchObject({
        requiresCharging: true,
        requiresBatteryNotLow: true,
        requiredNetworkType: 2,
      })
    })
  })
})
