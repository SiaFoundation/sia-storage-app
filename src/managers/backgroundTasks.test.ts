import BackgroundFetch from 'react-native-background-fetch'
import BackgroundTimer from 'react-native-background-timer'
import { initBackgroundTasks } from './backgroundTasks'

// Capture the callbacks passed to BackgroundFetch.configure so we can simulate OS behavior
let taskCallback: (taskId: string) => Promise<void>
let timeoutCallback: (taskId: string) => void

jest.mock('react-native-background-fetch', () => ({
  __esModule: true,
  default: {
    configure: jest.fn((config, onTask, onTimeout) => {
      taskCallback = onTask
      timeoutCallback = onTimeout
      return Promise.resolve(0)
    }),
    scheduleTask: jest.fn(() => Promise.resolve(true)),
    finish: jest.fn(),
    NETWORK_TYPE_UNMETERED: 2,
  },
}))

// Track timer state to simulate BackgroundTimer behavior
// Variables must be prefixed with 'mock' to be accessible inside jest.mock()
let mockTimerCallbacks: Map<number, () => void> = new Map()
let mockNextTimerId = 1

jest.mock('react-native-background-timer', () => ({
  __esModule: true,
  default: {
    setTimeout: jest.fn((cb: () => void, _ms: number) => {
      const id = mockNextTimerId++
      mockTimerCallbacks.set(id, cb)
      return id
    }),
    clearTimeout: jest.fn((id: number) => {
      mockTimerCallbacks.delete(id)
    }),
  },
}))

const mockGetFileCountLocal = jest.fn()
jest.mock('../stores/files', () => ({
  getFileCountLocal: (...args: unknown[]) => mockGetFileCountLocal(...args),
}))

jest.mock('../stores/sdk', () => ({
  getIsConnected: jest.fn(() => true),
}))

jest.mock('../stores/appKey', () => ({
  hasCachedAppKey: jest.fn(() => true),
}))

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}))

const mockTimer = jest.mocked(BackgroundTimer)

// Helpers
const flushPromises = () => new Promise(setImmediate)

function completeNextDelay() {
  const [id, cb] = mockTimerCallbacks.entries().next().value || []
  if (cb) {
    mockTimerCallbacks.delete(id)
    cb()
  }
}

function getPendingDelayCount() {
  return mockTimerCallbacks.size
}

describe('backgroundTasks', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    mockTimerCallbacks.clear()
    mockNextTimerId = 1
    mockGetFileCountLocal.mockReset()

    await initBackgroundTasks()
  })

  describe('polling loop behavior', () => {
    it('exits immediately when no files are pending upload', async () => {
      mockGetFileCountLocal.mockResolvedValue(0)

      await taskCallback('com.transistorsoft.fetch')

      // Should check file count once and exit - no delay started
      expect(mockGetFileCountLocal).toHaveBeenCalledTimes(1)
      expect(mockGetFileCountLocal).toHaveBeenCalledWith({ localOnly: true })
      expect(getPendingDelayCount()).toBe(0)
    })

    it('polls repeatedly while files are pending, exits when uploads complete', async () => {
      // Simulate: 5 files -> 2 files -> 0 files (uploads completing over time)
      mockGetFileCountLocal
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(0)

      const taskPromise = taskCallback('com.transistorsoft.fetch')

      // After first check (5 files), should start a delay
      await flushPromises()
      expect(mockGetFileCountLocal).toHaveBeenCalledTimes(1)
      expect(getPendingDelayCount()).toBe(1)

      // Complete delay, triggers second check (2 files)
      completeNextDelay()
      await flushPromises()
      expect(mockGetFileCountLocal).toHaveBeenCalledTimes(2)
      expect(getPendingDelayCount()).toBe(1)

      // Complete delay, triggers third check (0 files) -> exits
      completeNextDelay()
      await flushPromises()
      expect(mockGetFileCountLocal).toHaveBeenCalledTimes(3)

      await taskPromise

      // No pending delays after task completes
      expect(getPendingDelayCount()).toBe(0)
      // Verify polling loop iterated expected number of times
      expect(mockGetFileCountLocal).toHaveBeenCalledTimes(3)
    })
  })

  describe('timeout cancellation flow', () => {
    it('abort function resolves delay immediately, allowing clean exit', async () => {
      mockGetFileCountLocal.mockResolvedValue(100) // Always has files

      const taskPromise = taskCallback('com.transistorsoft.fetch')
      await flushPromises()

      // Task is now in delay, waiting
      expect(getPendingDelayCount()).toBe(1)

      // Simulate iOS timeout - this should abort the delay and exit cleanly
      timeoutCallback('com.transistorsoft.fetch')

      await taskPromise

      // Timer was cleared (not left dangling)
      expect(mockTimer.clearTimeout).toHaveBeenCalled()
      // No pending delays
      expect(getPendingDelayCount()).toBe(0)
    })

    it('setting status to finished causes loop to exit on next iteration', async () => {
      // This tests the state.status === 'finished' check in the while loop
      mockGetFileCountLocal.mockResolvedValue(50)

      const taskPromise = taskCallback('com.transistorsoft.fetch')
      await flushPromises()

      // Task checked files, found 50, started delay
      expect(mockGetFileCountLocal).toHaveBeenCalledTimes(1)

      // Timeout fires while in delay - sets status to 'finished' and aborts delay
      timeoutCallback('com.transistorsoft.fetch')

      await taskPromise

      // The loop exited after abort, didn't poll again
      expect(mockGetFileCountLocal).toHaveBeenCalledTimes(1)
    })
  })

  describe('task re-invocation handling', () => {
    it('new task aborts previous task delay to prevent stale state', async () => {
      mockGetFileCountLocal.mockResolvedValue(100)

      // Start first task
      const task1 = taskCallback('com.transistorsoft.fetch')
      await flushPromises()
      expect(getPendingDelayCount()).toBe(1)

      // Start second task for same ID before first completes
      // This simulates OS re-triggering the task
      const task2 = taskCallback('com.transistorsoft.fetch')
      await flushPromises()

      // First task's delay should have been aborted (clearTimeout called)
      expect(mockTimer.clearTimeout).toHaveBeenCalled()

      // Clean up - timeout the active task
      timeoutCallback('com.transistorsoft.fetch')
      await Promise.all([task1, task2])
    })

    it('each task invocation gets isolated delay instance', async () => {
      mockGetFileCountLocal.mockResolvedValue(10)

      // Start tasks for different IDs
      const fetchTask = taskCallback('com.transistorsoft.fetch')
      await flushPromises()

      const processingTask = taskCallback('com.transistorsoft.processing')
      await flushPromises()

      // Both tasks have pending delays
      expect(getPendingDelayCount()).toBe(2)

      // Timeout only affects its own task
      timeoutCallback('com.transistorsoft.fetch')
      await fetchTask

      // Processing task still has its delay
      expect(getPendingDelayCount()).toBe(1)

      // Clean up
      timeoutCallback('com.transistorsoft.processing')
      await processingTask
    })
  })

  describe('delay completion vs abort', () => {
    it('delay completing normally continues the loop', async () => {
      mockGetFileCountLocal
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(0)

      const taskPromise = taskCallback('com.transistorsoft.fetch')

      // First poll -> delay
      await flushPromises()
      expect(mockGetFileCountLocal).toHaveBeenCalledTimes(1)

      // Delay completes normally (not aborted) -> continues loop
      completeNextDelay()
      await flushPromises()
      expect(mockGetFileCountLocal).toHaveBeenCalledTimes(2)

      // Again
      completeNextDelay()
      await flushPromises()
      expect(mockGetFileCountLocal).toHaveBeenCalledTimes(3)

      await taskPromise
    })

    it('delay being aborted exits loop without further polling', async () => {
      mockGetFileCountLocal.mockResolvedValue(10)

      const taskPromise = taskCallback('com.transistorsoft.fetch')
      await flushPromises()

      // First poll happened
      expect(mockGetFileCountLocal).toHaveBeenCalledTimes(1)

      // Abort via timeout
      timeoutCallback('com.transistorsoft.fetch')
      await taskPromise

      // No additional polls after abort
      expect(mockGetFileCountLocal).toHaveBeenCalledTimes(1)
    })
  })

  describe('edge cases', () => {
    it('handles unknown task ID gracefully', async () => {
      // Should not throw, just finish immediately
      await taskCallback('unknown-task-id')

      expect(BackgroundFetch.finish).toHaveBeenCalledWith('unknown-task-id')
      // No file count check for unknown tasks
      expect(mockGetFileCountLocal).not.toHaveBeenCalled()
    })

    it('timeout for unknown task ID does not throw', () => {
      // Should not throw
      timeoutCallback('unknown-task-id')

      expect(BackgroundFetch.finish).toHaveBeenCalledWith('unknown-task-id')
    })
  })
})
