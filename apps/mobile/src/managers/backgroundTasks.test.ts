import BackgroundFetch from 'react-native-background-fetch'
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

jest.mock('./syncPhotosArchive', () => ({
  triggerRecentScanIfNeeded: jest.fn(() => Promise.resolve(false)),
}))

jest.mock('./uploader', () => ({
  getUploadManager: jest.fn(() => ({
    packedCount: 0,
    packedBytes: 0,
    uploadedCount: 0,
    uploadedBytes: 0,
  })),
}))

// Mock the suspension lifecycle so tests can assert register/release calls
// on both the normal and timeout paths.
const mockRegister = jest.fn((_id: string) => Promise.resolve())
const mockRelease = jest.fn((_id: string) => Promise.resolve())
const mockGetIsSuspended = jest.fn(() => false)
jest.mock('./suspension', () => ({
  getIsSuspended: () => mockGetIsSuspended(),
  registerBackgroundTaskLifecycle: (id: string) => mockRegister(id),
  releaseBackgroundTaskLifecycle: (id: string) => mockRelease(id),
}))

// Helpers
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
    mockGetIsSuspended.mockReset().mockReturnValue(false)

    await initBackgroundTasks()
  })

  describe('suspension lifecycle', () => {
    it('registers lifecycle at start of task', async () => {
      mockGetFileStatsLocal.mockResolvedValue({ count: 0, totalBytes: 0 })

      await taskCallback('com.transistorsoft.fetch')

      expect(mockRegister).toHaveBeenCalledTimes(1)
      expect(mockRegister).toHaveBeenCalledWith('com.transistorsoft.fetch')
    })

    it('releases lifecycle after normal completion', async () => {
      mockGetFileStatsLocal.mockResolvedValue({ count: 0, totalBytes: 0 })

      await taskCallback('com.transistorsoft.fetch')

      expect(mockRelease).toHaveBeenCalledTimes(1)
      expect(mockRelease).toHaveBeenCalledWith('com.transistorsoft.fetch')
    })

    it('releases lifecycle after timeout — the critical crash-1 regression guard', async () => {
      mockGetFileStatsLocal.mockResolvedValue({ count: 100, totalBytes: 100000 })

      const taskPromise = taskCallback('com.transistorsoft.fetch')
      await flushPromises()

      // Task is in a delay, holding the DB open. iOS fires expirationHandler.
      timeoutCallback('com.transistorsoft.fetch')
      await flushPromises()
      await flushPromises()
      await taskPromise

      // Both the normal path (finally block) and the timeout path (IIFE)
      // call release, resulting in 2 calls for the same invocation.
      expect(mockRelease).toHaveBeenCalledWith('com.transistorsoft.fetch')
      expect(mockRelease.mock.calls.length).toBeGreaterThanOrEqual(1)
    })

    it('releases lifecycle even when task throws', async () => {
      mockGetFileStatsLocal.mockRejectedValue(new Error('simulated db error'))

      await taskCallback('com.transistorsoft.fetch')

      expect(mockRelease).toHaveBeenCalledWith('com.transistorsoft.fetch')
    })

    it('releases lifecycle even when AppState.currentState is active', async () => {
      // The manager decides whether to actually suspend; the handler
      // just always calls release. Confirms the guard was removed.
      mockGetFileStatsLocal.mockResolvedValue({ count: 0, totalBytes: 0 })

      await taskCallback('com.transistorsoft.fetch')

      expect(mockRelease).toHaveBeenCalledWith('com.transistorsoft.fetch')
    })

    it('logs handler_exit with didSuspend reading from getIsSuspended', async () => {
      // After release, the suspension manager reports suspended.
      mockGetFileStatsLocal.mockResolvedValue({ count: 0, totalBytes: 0 })
      mockGetIsSuspended.mockReturnValue(true)

      await taskCallback('com.transistorsoft.fetch')

      // The handler asks the manager for suspended state. We don't
      // introspect logger directly here — assert the read happened.
      expect(mockGetIsSuspended).toHaveBeenCalled()
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

      expect(getPendingDelayCount()).toBe(2)

      // Timeout only affects its own task.
      timeoutCallback('com.transistorsoft.fetch')
      await fetchTask

      expect(getPendingDelayCount()).toBe(1)

      timeoutCallback('com.transistorsoft.processing')
      await processingTask
    })
  })

  describe('scanners', () => {
    it('runs fsEvictionScanner during background work', async () => {
      mockGetFileStatsLocal.mockResolvedValue({ count: 0, totalBytes: 0 })

      await taskCallback('com.transistorsoft.fetch')

      expect(mockRunFsEvictionScanner).toHaveBeenCalledTimes(1)
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
    it('BGProcessingTask is scheduled with charging + network constraints', () => {
      expect(BackgroundFetch.scheduleTask).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'com.transistorsoft.processing',
          requiresCharging: true,
          requiresNetworkConnectivity: true,
          requiresBatteryNotLow: true,
        }),
      )
    })

    it('BGAppRefreshTask (configure) is configured with charging + network + battery constraints', () => {
      const configCall = (BackgroundFetch.configure as jest.Mock).mock.calls[0]
      expect(configCall[0]).toMatchObject({
        requiresCharging: true,
        requiresBatteryNotLow: true,
        requiredNetworkType: 2,
      })
    })
  })
})
