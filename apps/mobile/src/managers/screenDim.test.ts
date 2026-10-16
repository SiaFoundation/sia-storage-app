type AppStateStatus = 'active' | 'inactive' | 'background' | 'unknown' | 'extension'

let mockCurrentState: AppStateStatus = 'active'
let mockListeners: Array<(state: AppStateStatus) => void> = []
let mockPlatformOS = 'ios'

jest.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mockPlatformOS
    },
  },
  AppState: {
    get currentState() {
      return mockCurrentState
    },
    addEventListener: jest.fn((_event: string, fn: (state: AppStateStatus) => void) => {
      mockListeners.push(fn)
      return { remove: jest.fn() }
    }),
  },
}))

// Stands in for the panel so the restore path's epsilon check runs against a
// value that reflects our writes. Assign it directly to simulate the user
// moving the slider.
let mockPanel = 0.7
const mockGet = jest.fn(async () => mockPanel)
const mockSet = jest.fn(async (value: number) => {
  mockPanel = value
})
// Android's restore drops the window override, so the panel goes back to the
// system's level, which in these tests is the level the user had.
const mockRestoreSystem = jest.fn(async () => {
  mockPanel = USER_LEVEL
})

jest.mock('expo-brightness', () => ({
  getBrightnessAsync: () => mockGet(),
  setBrightnessAsync: (value: number) => mockSet(value),
  restoreSystemBrightnessAsync: () => mockRestoreSystem(),
}))

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn().mockResolvedValue(undefined),
  deactivateKeepAwake: jest.fn(),
}))

const mockStorage = {
  getItem: jest.fn<Promise<string | null>, [string]>(),
  setItem: jest.fn<Promise<void>, [string, string]>(),
  removeItem: jest.fn<Promise<void>, [string]>(),
}

jest.mock('../stores/appService', () => ({
  app: () => ({ storage: mockStorage }),
}))

import {
  __resetAutoKeepAwakeForTesting,
  acquireAutoKeepAwake,
  releaseAutoKeepAwake,
} from './autoKeepAwake'
import { __resetLifecycleForTesting } from './lifecycle'
import {
  __resetScreenDimForTesting,
  initScreenDim,
  isScreenDimmed,
  noteUserActivity,
  setManualKeepAwakeHeld,
  undimScreen,
} from './screenDim'

const IDLE_DELAY_MS = 60_000
const DIM_LEVEL = 0.01
const RESTORE_LEVEL_KEY = 'screenDimRestoreLevel'
const USER_LEVEL = 0.7

function emit(state: AppStateStatus): void {
  mockCurrentState = state
  for (const fn of mockListeners) fn(state)
}

async function flush(): Promise<void> {
  await jest.advanceTimersByTimeAsync(0)
}

/** Runs out the idle timer and settles the async dim that follows. */
async function goIdle(): Promise<void> {
  await jest.advanceTimersByTimeAsync(IDLE_DELAY_MS)
  await flush()
}

async function init(): Promise<void> {
  initScreenDim()
  await flush()
}

/** Arms and dims, leaving the panel at DIM_LEVEL and the state 'dimmed'. */
async function dim(): Promise<void> {
  await init()
  setManualKeepAwakeHeld(true)
  await goIdle()
  expect(isScreenDimmed()).toBe(true)
  mockSet.mockClear()
  mockStorage.setItem.mockClear()
}

beforeEach(() => {
  jest.useFakeTimers()
  __resetScreenDimForTesting()
  __resetAutoKeepAwakeForTesting()
  __resetLifecycleForTesting()
  mockListeners = []
  mockCurrentState = 'active'
  mockPlatformOS = 'ios'
  mockPanel = USER_LEVEL
  mockGet.mockClear()
  mockSet.mockClear()
  mockRestoreSystem.mockClear()
  mockStorage.getItem.mockReset().mockResolvedValue(null)
  mockStorage.setItem.mockReset().mockResolvedValue(undefined)
  mockStorage.removeItem.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  jest.useRealTimers()
})

describe('arming', () => {
  it('the manual toggle turning on starts the idle timer', async () => {
    await init()
    setManualKeepAwakeHeld(true)

    await goIdle()
    expect(mockSet).toHaveBeenCalledWith(DIM_LEVEL)
  })

  it('an auto keep-awake intent starts the idle timer', async () => {
    await init()
    acquireAutoKeepAwake('archive-walk')

    await goIdle()
    expect(mockSet).toHaveBeenCalledWith(DIM_LEVEL)
  })

  it('no lock held never dims', async () => {
    await init()

    await goIdle()
    expect(mockSet).not.toHaveBeenCalled()
    expect(isScreenDimmed()).toBe(false)
  })

  it('a lock acquired while backgrounded does not arm', async () => {
    mockCurrentState = 'background'
    await init()
    setManualKeepAwakeHeld(true)

    await goIdle()
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('returning to the foreground arms a lock taken while backgrounded', async () => {
    mockCurrentState = 'background'
    await init()
    setManualKeepAwakeHeld(true)
    emit('active')

    await goIdle()
    expect(mockSet).toHaveBeenCalledWith(DIM_LEVEL)
  })

  it('user activity restarts the idle countdown', async () => {
    await init()
    setManualKeepAwakeHeld(true)

    await jest.advanceTimersByTimeAsync(IDLE_DELAY_MS - 1)
    noteUserActivity()
    await jest.advanceTimersByTimeAsync(IDLE_DELAY_MS - 1)
    expect(mockSet).not.toHaveBeenCalled()

    await goIdle()
    expect(mockSet).toHaveBeenCalledWith(DIM_LEVEL)
  })

  it('releasing the lock while armed makes no brightness call at all', async () => {
    await init()
    setManualKeepAwakeHeld(true)
    setManualKeepAwakeHeld(false)

    await goIdle()
    expect(mockGet).not.toHaveBeenCalled()
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('backgrounding while armed cancels the pending dim', async () => {
    await init()
    setManualKeepAwakeHeld(true)
    emit('background')

    await goIdle()
    expect(mockSet).not.toHaveBeenCalled()
  })
})

describe('dimming', () => {
  it('captures the current level and lowers the panel', async () => {
    await init()
    setManualKeepAwakeHeld(true)

    await goIdle()
    expect(mockSet).toHaveBeenCalledWith(DIM_LEVEL)
    expect(mockStorage.setItem).toHaveBeenCalledWith(RESTORE_LEVEL_KEY, String(USER_LEVEL))
    expect(isScreenDimmed()).toBe(true)
  })

  it('a rejected brightness write leaves the state armed and the key absent', async () => {
    mockSet.mockRejectedValueOnce(new Error('no brightness control'))
    await init()
    setManualKeepAwakeHeld(true)

    await goIdle()
    expect(isScreenDimmed()).toBe(false)
    expect(mockStorage.removeItem).toHaveBeenCalledWith(RESTORE_LEVEL_KEY)
  })

  it('a rejected brightness write retries on the next idle window, not on its own', async () => {
    mockSet.mockRejectedValueOnce(new Error('no brightness control'))
    await init()
    setManualKeepAwakeHeld(true)
    await goIdle()

    // A device with no brightness control shouldn't be retried every 60s.
    await goIdle()
    expect(isScreenDimmed()).toBe(false)

    noteUserActivity()
    await goIdle()
    expect(isScreenDimmed()).toBe(true)
  })

  it('a rejected brightness read leaves the state armed and writes no key', async () => {
    mockGet.mockRejectedValueOnce(new Error('unavailable'))
    await init()
    setManualKeepAwakeHeld(true)

    await goIdle()
    expect(isScreenDimmed()).toBe(false)
    expect(mockSet).not.toHaveBeenCalled()
    expect(mockStorage.setItem).not.toHaveBeenCalled()
  })

  it('does not persist the captured level on Android', async () => {
    mockPlatformOS = 'android'
    await init()
    setManualKeepAwakeHeld(true)

    await goIdle()
    expect(mockSet).toHaveBeenCalledWith(DIM_LEVEL)
    expect(mockStorage.setItem).not.toHaveBeenCalled()
  })
})

describe('restore', () => {
  it('a touch restores the level and re-arms', async () => {
    await dim()

    noteUserActivity()
    await flush()
    expect(mockSet).toHaveBeenCalledTimes(1)
    expect(mockSet).toHaveBeenCalledWith(USER_LEVEL)
    expect(isScreenDimmed()).toBe(false)
    expect(mockStorage.removeItem).toHaveBeenCalledWith(RESTORE_LEVEL_KEY)

    // Re-armed rather than off: the idle window starts over.
    await goIdle()
    expect(isScreenDimmed()).toBe(true)
  })

  it('releasing the last lock restores the level', async () => {
    await dim()

    setManualKeepAwakeHeld(false)
    await flush()
    expect(mockSet).toHaveBeenCalledTimes(1)
    expect(mockSet).toHaveBeenCalledWith(USER_LEVEL)
    expect(isScreenDimmed()).toBe(false)
  })

  it('backgrounding restores the level', async () => {
    await dim()

    emit('background')
    await flush()
    expect(mockSet).toHaveBeenCalledTimes(1)
    expect(mockSet).toHaveBeenCalledWith(USER_LEVEL)
    expect(isScreenDimmed()).toBe(false)
  })

  it('undimScreen restores the level', async () => {
    await dim()

    undimScreen()
    await flush()
    expect(mockSet).toHaveBeenCalledTimes(1)
    expect(mockSet).toHaveBeenCalledWith(USER_LEVEL)
  })

  it('keeps a level the user changed while dimmed', async () => {
    await dim()
    mockPanel = 0.9

    setManualKeepAwakeHeld(false)
    await flush()
    expect(mockSet).not.toHaveBeenCalled()
    expect(mockPanel).toBe(0.9)
    expect(mockStorage.removeItem).toHaveBeenCalledWith(RESTORE_LEVEL_KEY)
  })

  it('restores only once when two exits race', async () => {
    await dim()

    setManualKeepAwakeHeld(false)
    emit('background')
    await flush()
    expect(mockSet).toHaveBeenCalledTimes(1)
  })

  it('an exit landing mid-write still puts the level back', async () => {
    let finishWrite = () => {}
    mockSet.mockImplementationOnce(
      (value: number) =>
        new Promise<void>((resolve) => {
          finishWrite = () => {
            mockPanel = value
            resolve()
          }
        }),
    )

    await init()
    setManualKeepAwakeHeld(true)
    await jest.advanceTimersByTimeAsync(IDLE_DELAY_MS)

    // The dim's write is now in flight and the level is already captured.
    setManualKeepAwakeHeld(false)
    finishWrite()
    await flush()

    expect(isScreenDimmed()).toBe(false)
    expect(mockPanel).toBe(USER_LEVEL)
  })

  it('a restore whose read fails keeps the level, and the next touch puts it back', async () => {
    await dim()
    mockGet.mockRejectedValueOnce(new Error('read failed'))

    noteUserActivity()
    await flush()
    expect(mockPanel).toBe(DIM_LEVEL)
    expect(mockStorage.removeItem).not.toHaveBeenCalled()

    noteUserActivity()
    await flush()
    expect(mockPanel).toBe(USER_LEVEL)
    expect(mockStorage.removeItem).toHaveBeenCalledWith(RESTORE_LEVEL_KEY)
  })

  it('a restore whose write fails keeps the level, and the next dim does not record 1%', async () => {
    await dim()
    mockSet.mockRejectedValueOnce(new Error('write failed'))

    noteUserActivity()
    await flush()
    expect(mockPanel).toBe(DIM_LEVEL)

    await goIdle()
    expect(isScreenDimmed()).toBe(true)
    expect(mockStorage.setItem).not.toHaveBeenCalled()

    noteUserActivity()
    await flush()
    expect(mockPanel).toBe(USER_LEVEL)
  })

  it('on Android a restore hands brightness back to the system instead of writing a level', async () => {
    mockPlatformOS = 'android'
    await dim()

    noteUserActivity()
    await flush()
    expect(mockRestoreSystem).toHaveBeenCalledTimes(1)
    expect(mockSet).not.toHaveBeenCalled()
    expect(isScreenDimmed()).toBe(false)
  })

  it('a touch while a dim is being written leaves the panel bright', async () => {
    let finishWrite = () => {}
    mockSet.mockImplementationOnce(
      (value: number) =>
        new Promise<void>((resolve) => {
          finishWrite = () => {
            mockPanel = value
            resolve()
          }
        }),
    )

    await init()
    setManualKeepAwakeHeld(true)
    await jest.advanceTimersByTimeAsync(IDLE_DELAY_MS)

    noteUserActivity()
    finishWrite()
    await flush()

    expect(isScreenDimmed()).toBe(false)
    expect(mockPanel).toBe(USER_LEVEL)
  })

  it('a touch while the level is being saved keeps nothing, so a later dim saves the level then', async () => {
    let finishSave = () => {}
    mockStorage.setItem.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve
        }),
    )
    await init()
    setManualKeepAwakeHeld(true)
    await jest.advanceTimersByTimeAsync(IDLE_DELAY_MS)

    noteUserActivity()
    finishSave()
    await flush()
    expect(isScreenDimmed()).toBe(false)
    expect(mockStorage.removeItem).toHaveBeenCalledWith(RESTORE_LEVEL_KEY)

    mockPanel = 0.9
    await goIdle()
    noteUserActivity()
    await flush()
    expect(mockPanel).toBe(0.9)
  })

  it('backgrounding and returning while the dim is being written leaves the panel bright and dims again later', async () => {
    let finishWrite = () => {}
    mockSet.mockImplementationOnce(
      (value: number) =>
        new Promise<void>((resolve) => {
          finishWrite = () => {
            mockPanel = value
            resolve()
          }
        }),
    )
    await init()
    setManualKeepAwakeHeld(true)
    await jest.advanceTimersByTimeAsync(IDLE_DELAY_MS)

    emit('background')
    emit('active')
    finishWrite()
    await flush()
    expect(isScreenDimmed()).toBe(false)
    expect(mockPanel).toBe(USER_LEVEL)

    await goIdle()
    expect(isScreenDimmed()).toBe(true)
  })

  it('a restore that fails as the last lock goes is retried by a touch, without dimming again', async () => {
    await dim()
    mockSet.mockRejectedValueOnce(new Error('write failed'))

    setManualKeepAwakeHeld(false)
    await flush()
    expect(mockPanel).toBe(DIM_LEVEL)

    noteUserActivity()
    await flush()
    expect(mockPanel).toBe(USER_LEVEL)
    await goIdle()
    expect(isScreenDimmed()).toBe(false)
  })

  it('Control Center or the app switcher restores the level, and dimming waits until the app is active again', async () => {
    await dim()

    emit('inactive')
    await flush()
    expect(mockPanel).toBe(USER_LEVEL)
    await goIdle()
    expect(isScreenDimmed()).toBe(false)

    emit('active')
    await goIdle()
    expect(isScreenDimmed()).toBe(true)
  })

  it('a foreground return after a dimmed background does not re-dim on its own', async () => {
    await dim()
    emit('background')
    await flush()
    mockSet.mockClear()

    emit('active')
    await flush()
    expect(isScreenDimmed()).toBe(false)
    expect(mockSet).not.toHaveBeenCalled()
  })
})

describe('crash recovery', () => {
  it('restores and clears a level left behind by a previous run', async () => {
    mockStorage.getItem.mockResolvedValue(String(USER_LEVEL))
    mockPanel = DIM_LEVEL

    await init()
    expect(mockSet).toHaveBeenCalledWith(USER_LEVEL)
    expect(mockStorage.removeItem).toHaveBeenCalledWith(RESTORE_LEVEL_KEY)
  })

  it('skips the write when the device was locked since the crash', async () => {
    mockStorage.getItem.mockResolvedValue(String(USER_LEVEL))
    mockPanel = 0.55

    await init()
    expect(mockSet).not.toHaveBeenCalled()
    expect(mockStorage.removeItem).toHaveBeenCalledWith(RESTORE_LEVEL_KEY)
  })

  it('never reads or restores a persisted level on Android', async () => {
    mockPlatformOS = 'android'
    mockStorage.getItem.mockResolvedValue(String(USER_LEVEL))
    mockPanel = DIM_LEVEL

    await init()
    expect(mockStorage.getItem).not.toHaveBeenCalled()
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('discards an unparseable persisted level', async () => {
    mockStorage.getItem.mockResolvedValue('not-a-number')

    await init()
    expect(mockSet).not.toHaveBeenCalled()
    expect(mockStorage.removeItem).toHaveBeenCalledWith(RESTORE_LEVEL_KEY)
  })
})

describe('union of the two keep-awake layers', () => {
  it('stays dimmed while the other layer still holds a lock', async () => {
    await init()
    setManualKeepAwakeHeld(true)
    acquireAutoKeepAwake('import-progress')
    await goIdle()

    releaseAutoKeepAwake('import-progress')
    await flush()
    expect(isScreenDimmed()).toBe(true)
    expect(mockSet).toHaveBeenCalledTimes(1)
  })

  it('restores once the last layer releases', async () => {
    await init()
    setManualKeepAwakeHeld(true)
    acquireAutoKeepAwake('import-progress')
    await goIdle()
    mockSet.mockClear()

    releaseAutoKeepAwake('import-progress')
    setManualKeepAwakeHeld(false)
    await flush()
    expect(isScreenDimmed()).toBe(false)
    expect(mockSet).toHaveBeenCalledWith(USER_LEVEL)
  })

  it('picks up a lock acquired before init', async () => {
    acquireAutoKeepAwake('sync-gate')
    await init()

    await goIdle()
    expect(mockSet).toHaveBeenCalledWith(DIM_LEVEL)
  })
})
