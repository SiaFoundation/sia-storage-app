type AppStateStatus = 'active' | 'inactive' | 'background' | 'unknown' | 'extension'

let mockCurrentState: AppStateStatus = 'active'
let mockListeners: Array<(state: AppStateStatus) => void> = []
const mockRemove = jest.fn()

jest.mock('react-native', () => ({
  AppState: {
    get currentState() {
      return mockCurrentState
    },
    addEventListener: jest.fn((_event: string, fn: (state: AppStateStatus) => void) => {
      mockListeners.push(fn)
      return { remove: mockRemove }
    }),
  },
}))

const mockActivate = jest.fn().mockResolvedValue(undefined)
const mockDeactivate = jest.fn()

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: (tag?: string) => mockActivate(tag),
  deactivateKeepAwake: (tag?: string) => mockDeactivate(tag),
}))

import {
  __resetAutoKeepAwakeForTesting,
  acquireAutoKeepAwake,
  initAutoKeepAwake,
  releaseAutoKeepAwake,
} from './autoKeepAwake'
import { __resetLifecycleForTesting } from './lifecycle'

function emit(state: AppStateStatus): void {
  mockCurrentState = state
  for (const fn of mockListeners) fn(state)
}

function resetAll(initialState: AppStateStatus = 'active'): void {
  __resetAutoKeepAwakeForTesting()
  __resetLifecycleForTesting()
  mockListeners = []
  mockRemove.mockClear()
  mockActivate.mockClear()
  mockDeactivate.mockClear()
  mockCurrentState = initialState
}

beforeEach(() => {
  resetAll('active')
})

afterEach(() => {
  __resetAutoKeepAwakeForTesting()
  __resetLifecycleForTesting()
})

describe('acquire / release', () => {
  it('first acquire in foreground activates the lock', () => {
    acquireAutoKeepAwake('a')
    expect(mockActivate).toHaveBeenCalledTimes(1)
    expect(mockActivate).toHaveBeenCalledWith('auto')
  })

  it('second acquire (different tag) does not re-activate', () => {
    acquireAutoKeepAwake('a')
    acquireAutoKeepAwake('b')
    expect(mockActivate).toHaveBeenCalledTimes(1)
  })

  it('double-acquire same tag is idempotent', () => {
    acquireAutoKeepAwake('a')
    acquireAutoKeepAwake('a')
    expect(mockActivate).toHaveBeenCalledTimes(1)
  })

  it('release with other tags still held does not deactivate', () => {
    acquireAutoKeepAwake('a')
    acquireAutoKeepAwake('b')
    releaseAutoKeepAwake('a')
    expect(mockDeactivate).not.toHaveBeenCalled()
  })

  it('release of last tag deactivates the lock', () => {
    acquireAutoKeepAwake('a')
    releaseAutoKeepAwake('a')
    expect(mockDeactivate).toHaveBeenCalledTimes(1)
    expect(mockDeactivate).toHaveBeenCalledWith('auto')
  })

  it('double-release same tag is idempotent', () => {
    acquireAutoKeepAwake('a')
    releaseAutoKeepAwake('a')
    releaseAutoKeepAwake('a')
    expect(mockDeactivate).toHaveBeenCalledTimes(1)
  })

  it('release of unknown tag is a no-op', () => {
    releaseAutoKeepAwake('never-acquired')
    expect(mockDeactivate).not.toHaveBeenCalled()
  })
})

describe('lifecycle suspend / resume', () => {
  it('background deactivates the lock but keeps intent', () => {
    acquireAutoKeepAwake('a')
    expect(mockActivate).toHaveBeenCalledTimes(1)

    emit('background')
    expect(mockDeactivate).toHaveBeenCalledTimes(1)
  })

  it('foreground after background reactivates if intent remains', () => {
    acquireAutoKeepAwake('a')
    emit('background')
    expect(mockDeactivate).toHaveBeenCalledTimes(1)
    mockActivate.mockClear()

    emit('active')
    expect(mockActivate).toHaveBeenCalledTimes(1)
  })

  it('foreground after background with no intent does not reactivate', () => {
    acquireAutoKeepAwake('a')
    releaseAutoKeepAwake('a')
    emit('background')
    mockActivate.mockClear()

    emit('active')
    expect(mockActivate).not.toHaveBeenCalled()
  })

  it('acquire while backgrounded does not activate the lock', () => {
    resetAll('background')

    acquireAutoKeepAwake('a')
    expect(mockActivate).not.toHaveBeenCalled()
  })

  it('foreground transition activates a tag acquired while backgrounded', () => {
    resetAll('background')

    acquireAutoKeepAwake('a')
    expect(mockActivate).not.toHaveBeenCalled()

    emit('active')
    expect(mockActivate).toHaveBeenCalledTimes(1)
  })
})

describe('init', () => {
  it('initAutoKeepAwake is idempotent', () => {
    initAutoKeepAwake()
    initAutoKeepAwake()
    // Lifecycle subscription (single AppState listener) was attached only once.
    expect(mockListeners).toHaveLength(1)
  })

  it('acquire without prior init still wires lifecycle', () => {
    expect(mockListeners).toHaveLength(0)
    acquireAutoKeepAwake('a')
    expect(mockListeners).toHaveLength(1)

    emit('background')
    expect(mockDeactivate).toHaveBeenCalledTimes(1)
  })
})
