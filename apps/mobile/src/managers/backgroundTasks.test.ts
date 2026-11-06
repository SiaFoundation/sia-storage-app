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
  ms: number
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
  delayWithSignal: (ms: number, signal: AbortSignal) =>
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
        ms,
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

let mockActiveUploads: string[] = []
let mockReadyImports: unknown[] = []
let mockCopies = { files: 0, bytesCopied: 0 }
let mockArchiveWalk = false
let mockArchiveScanned = 0
// Set by a test to record which reads run first.
let mockReadOrder: string[] | null = null
const mockCountSyncUp = jest.fn(() => Promise.resolve(0))
let mockSyncingDown = false
let mockSyncDownCursor = 0
let mockSyncDownRuns = 0
// A trigger finishes a run at once unless a test holds it.
let mockSyncDownRunsOnTrigger = true
let mockConnected = true
let mockUploads: Record<string, { status: string; progress: number; size: number }> = {}
let mockUploadedBytes = 0

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
      getIndexerURL: jest.fn(() => Promise.resolve('https://indexer.test')),
      getAutoSyncDownEvents: jest.fn(() => Promise.resolve(true)),
    },
    imports: {
      pendingFiles: () => Promise.resolve(mockReadyImports),
      activeCopies: () => {
        mockReadOrder?.push('imports')
        return Promise.resolve(mockCopies)
      },
    },
    localObjects: {
      countSyncUp: () => mockCountSyncUp(),
    },
    sync: {
      getState: () => ({ isSyncingDown: mockSyncingDown, syncDownRuns: mockSyncDownRuns }),
      getSyncDownCursor: () => Promise.resolve({ id: `event-${mockSyncDownCursor}` }),
    },
    connection: {
      getState: () => ({ isConnected: mockConnected }),
    },
    uploads: {
      getActiveIds: () => [...mockActiveUploads, ...Object.keys(mockUploads)],
      getEntry: (id: string) => mockUploads[id],
    },
  })),
}))

const mockRunFsEvictionScanner = jest.fn((_opts?: { signal?: AbortSignal }) =>
  Promise.resolve(undefined),
)
jest.mock('./fsEvictionScanner', () => ({
  runFsEvictionScanner: (opts?: { signal?: AbortSignal }) => mockRunFsEvictionScanner(opts),
}))

const mockRunFsOrphanScanner = jest.fn((_opts?: { signal?: AbortSignal }) =>
  Promise.resolve(undefined),
)
jest.mock('./syncPhotosArchive', () => ({
  isArchiveWalkActive: () => mockArchiveWalk,
  getPhotosScannedCount: () => Promise.resolve(mockArchiveScanned),
}))

jest.mock('./syncDownEvents', () => ({
  triggerSyncDownEvents: () => {
    if (mockSyncDownRunsOnTrigger) mockSyncDownRuns++
  },
}))

jest.mock('./fsOrphanScanner', () => ({
  runFsOrphanScanner: (opts?: { signal?: AbortSignal }) => mockRunFsOrphanScanner(opts),
}))

jest.mock('./uploader', () => ({
  getUploadManager: jest.fn(() => ({
    packedCount: 0,
    packedBytes: 0,
    uploadedCount: 0,
    uploadedBytes: mockUploadedBytes,
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
    mockActiveUploads = []
    mockReadyImports = []
    mockCopies = { files: 0, bytesCopied: 0 }
    mockArchiveWalk = false
    mockArchiveScanned = 0
    mockReadOrder = null
    mockSyncingDown = false
    mockSyncDownCursor = 0
    mockSyncDownRuns = 0
    mockSyncDownRunsOnTrigger = true
    mockConnected = true
    mockUploads = {}
    mockUploadedBytes = 0
    mockCountSyncUp.mockReset().mockResolvedValue(0)
    mockGetFileStatsLocal.mockReset()
    mockRunFsEvictionScanner.mockReset().mockResolvedValue(undefined)
    mockRunFsOrphanScanner.mockReset().mockResolvedValue(undefined)
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

    it('keeps polling while the uploader holds a file that no longer counts as waiting', async () => {
      // A newer copy with its name made it an old version, which the waiting count skips.
      mockGetFileStatsLocal.mockResolvedValue({ count: 0, totalBytes: 0 })
      mockActiveUploads = ['old-version']

      const taskPromise = taskCallback('com.transistorsoft.fetch')
      await flushPromises()
      expect(getPendingDelayCount()).toBe(1)

      mockActiveUploads = []
      completeNextDelay()
      await taskPromise
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

      // Each task parks one poll delay.
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
    it('skips fsEvictionScanner inside BGAppRefreshTask budget', async () => {
      mockGetFileStatsLocal.mockResolvedValue({ count: 0, totalBytes: 0 })

      await taskCallback('com.transistorsoft.fetch')

      expect(mockRunFsEvictionScanner).not.toHaveBeenCalled()
    })

    it('a processing task finishes its eviction pass before it returns, with nothing else to do', async () => {
      mockGetFileStatsLocal.mockResolvedValue({ count: 0, totalBytes: 0 })

      await taskCallback('com.transistorsoft.processing')

      expect(mockRunFsEvictionScanner).toHaveBeenCalledTimes(1)
      expect(getPendingDelayCount()).toBe(0)
      expect(BackgroundFetch.finish).toHaveBeenCalledWith('com.transistorsoft.processing')
    })

    it('a processing task does not finish while its eviction pass is still running', async () => {
      mockGetFileStatsLocal.mockResolvedValue({ count: 0, totalBytes: 0 })
      let endPass: () => void = () => {}
      mockRunFsEvictionScanner.mockImplementationOnce(
        () => new Promise((resolve) => (endPass = () => resolve(undefined))),
      )

      const taskPromise = taskCallback('com.transistorsoft.processing')
      await flushPromises()
      expect(BackgroundFetch.finish).not.toHaveBeenCalled()

      endPass()
      await taskPromise
      expect(BackgroundFetch.finish).toHaveBeenCalledWith('com.transistorsoft.processing')
    })
    it('a processing task that times out mid-eviction finishes once and does not wait on uploads', async () => {
      mockGetFileStatsLocal.mockResolvedValue({ count: 1, totalBytes: 100 })
      let endPass: () => void = () => {}
      mockRunFsEvictionScanner.mockImplementationOnce(
        () => new Promise((resolve) => (endPass = () => resolve(undefined))),
      )

      const taskPromise = taskCallback('com.transistorsoft.processing')
      await flushPromises()
      timeoutCallback('com.transistorsoft.processing')
      await flushPromises()
      // The pass sees the aborted signal and returns.
      endPass()
      await taskPromise

      expect(BackgroundFetch.finish).toHaveBeenCalledTimes(1)
      expect(getPendingDelayCount()).toBe(0)
      expect(mockGetFileStatsLocal).not.toHaveBeenCalled()
    })

    it('the fetch task runs the daily orphan scan and no eviction pass', async () => {
      mockGetFileStatsLocal.mockResolvedValue({ count: 0, totalBytes: 0 })

      await taskCallback('com.transistorsoft.fetch')

      expect(mockRunFsOrphanScanner).toHaveBeenCalledTimes(1)
      expect(mockRunFsEvictionScanner).not.toHaveBeenCalled()
    })

    it('the fetch task stops waiting at its soft deadline on a scan that ignores its signal', async () => {
      // A scan the processing task started, which this task only joined.
      mockGetFileStatsLocal.mockResolvedValue({ count: 0, totalBytes: 0 })
      mockRunFsOrphanScanner.mockImplementationOnce(() => new Promise(() => {}))

      const taskPromise = taskCallback('com.transistorsoft.fetch')
      await flushPromises()
      // The deadline waits on delayWithSignal, which runs in the background.
      expect(mockPendingDelays.map((d) => d.ms)).toEqual([expect.closeTo(25_000, -3)])
      expect(BackgroundFetch.finish).not.toHaveBeenCalled()

      completeNextDelay()
      await taskPromise
      expect(BackgroundFetch.finish).toHaveBeenCalledTimes(1)
    })

    it('a processing task runs the orphan scan after its eviction pass', async () => {
      mockGetFileStatsLocal.mockResolvedValue({ count: 0, totalBytes: 0 })
      const order: string[] = []
      mockRunFsEvictionScanner.mockImplementationOnce(async () => {
        order.push('evict')
        return undefined
      })
      mockRunFsOrphanScanner.mockImplementationOnce(async () => {
        order.push('orphans')
        return undefined
      })

      await taskCallback('com.transistorsoft.processing')

      expect(order).toEqual(['evict', 'orphans'])
    })

    it('a task does not finish while its orphan scan is still running', async () => {
      mockGetFileStatsLocal.mockResolvedValue({ count: 0, totalBytes: 0 })
      let endScan: () => void = () => {}
      mockRunFsOrphanScanner.mockImplementationOnce(
        () => new Promise((resolve) => (endScan = () => resolve(undefined))),
      )

      const taskPromise = taskCallback('com.transistorsoft.processing')
      await flushPromises()
      expect(BackgroundFetch.finish).not.toHaveBeenCalled()

      endScan()
      await taskPromise
      expect(BackgroundFetch.finish).toHaveBeenCalledWith('com.transistorsoft.processing')
    })

    it('a processing task stops waiting at its soft deadline on an eviction pass it only joined', async () => {
      // Resuming the suspended app started this pass, without the task's signal.
      mockGetFileStatsLocal.mockResolvedValue({ count: 0, totalBytes: 0 })
      mockRunFsEvictionScanner.mockImplementationOnce(() => new Promise(() => {}))

      const taskPromise = taskCallback('com.transistorsoft.processing')
      await flushPromises()
      expect(mockPendingDelays.map((d) => d.ms)).toEqual([expect.closeTo(270_000, -3)])

      completeNextDelay()
      await taskPromise
      expect(BackgroundFetch.finish).toHaveBeenCalledTimes(1)
      expect(mockRunFsOrphanScanner).not.toHaveBeenCalled()
    })

    it('a processing task stops a pass still running at its soft deadline', async () => {
      mockGetFileStatsLocal.mockResolvedValue({ count: 1, totalBytes: 100 })
      mockRunFsEvictionScanner.mockImplementationOnce(
        (opts) =>
          new Promise((resolve) =>
            opts?.signal?.addEventListener('abort', () => resolve(undefined)),
          ),
      )

      const taskPromise = taskCallback('com.transistorsoft.processing')
      await flushPromises()
      expect(BackgroundFetch.finish).not.toHaveBeenCalled()

      completeNextDelay()
      await taskPromise
      expect(BackgroundFetch.finish).toHaveBeenCalledTimes(1)
      expect(mockRunFsOrphanScanner).not.toHaveBeenCalled()
    })
  })

  describe('a processing task that cannot make progress', () => {
    let clock: number
    let nowSpy: jest.SpyInstance

    beforeEach(() => {
      clock = 1_000_000
      nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => clock)
      mockGetFileStatsLocal.mockResolvedValue({ count: 3, totalBytes: 300 })
    })
    afterEach(() => nowSpy.mockRestore())

    /** Moves the clock and lets the loop take its next reading. */
    async function tick(seconds: number) {
      clock += seconds * 1000
      completeNextDelay()
      await flushPromises()
    }

    it('stops 30 seconds after it loses the indexer', async () => {
      mockConnected = false
      const taskPromise = taskCallback('com.transistorsoft.processing')
      await flushPromises()

      await tick(20)
      expect(BackgroundFetch.finish).not.toHaveBeenCalled()

      await tick(10)
      await taskPromise
      expect(BackgroundFetch.finish).toHaveBeenCalledWith('com.transistorsoft.processing')
    })

    it('keeps waiting without the indexer while an import has files to copy', async () => {
      mockConnected = false
      mockReadyImports = [{ id: 'ready' }]
      const taskPromise = taskCallback('com.transistorsoft.processing')
      await flushPromises()

      for (let i = 0; i < 6; i++) {
        mockUploadedBytes += 1
        await tick(10)
      }
      expect(BackgroundFetch.finish).not.toHaveBeenCalled()

      timeoutCallback('com.transistorsoft.processing')
      await taskPromise
    })

    it('keeps waiting past 2 minutes while sync-down reads more of the library', async () => {
      mockGetFileStatsLocal.mockResolvedValue({ count: 0, totalBytes: 0 })
      mockSyncingDown = true
      const taskPromise = taskCallback('com.transistorsoft.processing')
      await flushPromises()

      // Events sharing a timestamp leave the progress fraction where it is,
      // while each committed batch moves the cursor.
      for (let i = 1; i <= 18; i++) {
        mockSyncDownCursor = i
        await tick(10)
      }
      expect(BackgroundFetch.finish).not.toHaveBeenCalled()

      timeoutCallback('com.transistorsoft.processing')
      await taskPromise
    })

    it('keeps waiting when the indexer comes back within 30 seconds', async () => {
      mockConnected = false
      const taskPromise = taskCallback('com.transistorsoft.processing')
      await flushPromises()

      await tick(20)
      mockConnected = true
      mockUploadedBytes = 100
      await tick(10)
      mockConnected = false
      await tick(20)
      expect(BackgroundFetch.finish).not.toHaveBeenCalled()

      timeoutCallback('com.transistorsoft.processing')
      await taskPromise
    })

    it('stops after 2 minutes in which nothing moves forward', async () => {
      const taskPromise = taskCallback('com.transistorsoft.processing')
      await flushPromises()

      for (let i = 0; i < 11; i++) await tick(10)
      expect(BackgroundFetch.finish).not.toHaveBeenCalled()

      await tick(10)
      await taskPromise
      expect(BackgroundFetch.finish).toHaveBeenCalledWith('com.transistorsoft.processing')
    })

    it('keeps waiting past 2 minutes while the photo walk passes photos already imported', async () => {
      mockGetFileStatsLocal.mockResolvedValue({ count: 0, totalBytes: 0 })
      mockArchiveWalk = true
      const taskPromise = taskCallback('com.transistorsoft.processing')
      await flushPromises()

      for (let i = 1; i <= 18; i++) {
        mockArchiveScanned = i * 100
        await tick(10)
      }
      expect(BackgroundFetch.finish).not.toHaveBeenCalled()

      timeoutCallback('com.transistorsoft.processing')
      await taskPromise
    })

    it('stops when retries push an upload past its size without finishing it', async () => {
      const taskPromise = taskCallback('com.transistorsoft.processing')
      await flushPromises()

      // A failed batch keeps adding shard bytes, so progress climbs past 1.
      // It reaches 1 at 40 seconds and nothing counts after that.
      for (let i = 1; i <= 15; i++) {
        mockUploads = { stuck: { status: 'uploading', progress: i / 4, size: 1000 } }
        await tick(10)
      }
      expect(BackgroundFetch.finish).not.toHaveBeenCalled()

      mockUploads = { stuck: { status: 'uploading', progress: 4, size: 1000 } }
      await tick(10)
      await taskPromise
      expect(BackgroundFetch.finish).toHaveBeenCalledWith('com.transistorsoft.processing')
    })

    it('keeps waiting past 2 minutes while one import copy keeps writing bytes', async () => {
      mockGetFileStatsLocal.mockResolvedValue({ count: 0, totalBytes: 0 })
      mockCopies = { files: 1, bytesCopied: 0 }
      const taskPromise = taskCallback('com.transistorsoft.processing')
      await flushPromises()

      for (let i = 1; i <= 18; i++) {
        mockCopies = { files: 1, bytesCopied: i * 1_000_000 }
        await tick(10)
      }
      expect(BackgroundFetch.finish).not.toHaveBeenCalled()

      timeoutCallback('com.transistorsoft.processing')
      await taskPromise
    })

    it('keeps waiting past 2 minutes while a large upload keeps sending bytes', async () => {
      const taskPromise = taskCallback('com.transistorsoft.processing')
      await flushPromises()

      // The uploader leaves a file `packing` while its bytes stream out.
      for (let i = 1; i <= 18; i++) {
        mockUploads = { big: { status: 'packing', progress: i / 20, size: 1_000_000 } }
        await tick(10)
      }
      expect(BackgroundFetch.finish).not.toHaveBeenCalled()

      timeoutCallback('com.transistorsoft.processing')
      await taskPromise
    })

    it('stops when an upload fails at the same point on every retry', async () => {
      const taskPromise = taskCallback('com.transistorsoft.processing')
      await flushPromises()

      // It first reaches half way at 20 seconds, and never gets past it.
      for (let i = 0; i < 13; i++) {
        mockUploads = {
          stuck: { status: 'uploading', progress: i % 2 === 0 ? 0 : 0.5, size: 1000 },
        }
        await tick(10)
      }
      expect(BackgroundFetch.finish).not.toHaveBeenCalled()

      await tick(10)
      await taskPromise
      expect(BackgroundFetch.finish).toHaveBeenCalledWith('com.transistorsoft.processing')
    })
  })

  describe('pending work in a processing task', () => {
    beforeEach(() => {
      mockGetFileStatsLocal.mockResolvedValue({ count: 0, totalBytes: 0 })
    })

    it('stays awake while metadata waits to sync up, with nothing to upload', async () => {
      mockCountSyncUp.mockResolvedValueOnce(3).mockResolvedValue(0)

      const taskPromise = taskCallback('com.transistorsoft.processing')
      await flushPromises()
      expect(getPendingDelayCount()).toBe(1)
      expect(BackgroundFetch.finish).not.toHaveBeenCalled()

      completeNextDelay()
      await taskPromise
      expect(mockCountSyncUp).toHaveBeenCalledTimes(2)
    })

    it('stays awake while an import has files ready to copy', async () => {
      mockReadyImports = [{ id: 'ready' }]

      const taskPromise = taskCallback('com.transistorsoft.processing')
      await flushPromises()
      expect(getPendingDelayCount()).toBe(1)
      expect(BackgroundFetch.finish).not.toHaveBeenCalled()

      mockReadyImports = []
      completeNextDelay()
      await taskPromise
    })

    it('stays awake while an import is copying a claimed batch', async () => {
      mockCopies = { files: 2, bytesCopied: 0 }

      const taskPromise = taskCallback('com.transistorsoft.processing')
      await flushPromises()
      expect(getPendingDelayCount()).toBe(1)
      expect(BackgroundFetch.finish).not.toHaveBeenCalled()

      mockCopies = { files: 0, bytesCopied: 0 }
      completeNextDelay()
      await taskPromise
    })

    it('reads imports before uploads, so a file an import finishes between them is still seen', async () => {
      const order: string[] = []
      mockReadOrder = order
      mockGetFileStatsLocal.mockImplementation(async () => {
        order.push('uploads')
        return { count: 0, totalBytes: 0 }
      })

      await taskCallback('com.transistorsoft.processing')

      // The first reading of the wait loop, after the initial upload count.
      const reading = order.indexOf('imports')
      expect(reading).toBeGreaterThan(0)
      expect(order[reading + 1]).toBe('uploads')
    })

    it('stays awake while the photo library walk is still finding files', async () => {
      mockArchiveWalk = true

      const taskPromise = taskCallback('com.transistorsoft.processing')
      await flushPromises()
      expect(getPendingDelayCount()).toBe(1)
      expect(BackgroundFetch.finish).not.toHaveBeenCalled()

      mockArchiveWalk = false
      completeNextDelay()
      await taskPromise
    })

    it('stays awake until a sync-down run has finished since the task started', async () => {
      mockSyncDownRunsOnTrigger = false

      const taskPromise = taskCallback('com.transistorsoft.processing')
      await flushPromises()
      expect(getPendingDelayCount()).toBe(1)
      expect(BackgroundFetch.finish).not.toHaveBeenCalled()

      mockSyncDownRuns++
      completeNextDelay()
      await taskPromise
      expect(BackgroundFetch.finish).toHaveBeenCalledWith('com.transistorsoft.processing')
    })

    it('stays awake while a sync-down is running', async () => {
      mockSyncingDown = true

      const taskPromise = taskCallback('com.transistorsoft.processing')
      await flushPromises()
      expect(getPendingDelayCount()).toBe(1)
      expect(BackgroundFetch.finish).not.toHaveBeenCalled()

      mockSyncingDown = false
      completeNextDelay()
      await taskPromise
    })

    it('the fetch task waits on uploads alone and exits with metadata still waiting', async () => {
      mockCountSyncUp.mockResolvedValue(3)

      await taskCallback('com.transistorsoft.fetch')

      expect(getPendingDelayCount()).toBe(0)
      expect(mockCountSyncUp).not.toHaveBeenCalled()
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
