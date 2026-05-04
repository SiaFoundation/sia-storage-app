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

// @siastorage/logger is mocked globally in apps/mobile/jest.setup.cjs;
// we read its `warn` mock by reference to assert on listener-error logging.
import { logger } from '@siastorage/logger'

import {
  __resetLifecycleForTesting,
  addForegroundFocusListener,
  addLifecycleListener,
  deriveLifecycle,
  getLifecycle,
  initLifecycle,
} from './lifecycle'

const mockLoggerWarn = logger.warn as jest.Mock

function emit(state: AppStateStatus): void {
  mockCurrentState = state
  for (const fn of mockListeners) fn(state)
}

/**
 * Reset BOTH the lifecycle module AND the mock listeners array so that
 * the next initLifecycle re-attaches into a clean slate. Without this the
 * mock's previous handlers stay in `mockListeners` (the test mock's
 * `remove` doesn't actually mutate the array), and stale invocations can
 * mask real bugs.
 */
function resetAll(initialState: AppStateStatus = 'active'): void {
  __resetLifecycleForTesting()
  mockListeners = []
  mockRemove.mockClear()
  mockLoggerWarn.mockClear()
  mockCurrentState = initialState
}

beforeEach(() => {
  resetAll('active')
})

afterEach(() => {
  __resetLifecycleForTesting()
})

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('deriveLifecycle', () => {
  it.each<[AppStateStatus, 'foreground' | 'background']>([
    ['active', 'foreground'],
    ['inactive', 'foreground'],
    ['background', 'background'],
    ['unknown', 'background'],
    ['extension', 'background'],
  ])('maps %s -> %s', (input, expected) => {
    expect(deriveLifecycle(input)).toBe(expected)
  })
})

describe('lifecycle transitions', () => {
  it('active -> inactive does NOT fire (both foreground)', async () => {
    addLifecycleListener(() => {
      throw new Error('lifecycle listener should not fire')
    })
    addForegroundFocusListener(() => {
      throw new Error('focus listener should not fire')
    })

    emit('inactive')
    await flushMicrotasks()

    expect(getLifecycle()).toBe('foreground')
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })

  it('inactive -> active does NOT fire (both foreground)', async () => {
    resetAll('inactive')
    const events: string[] = []
    addLifecycleListener((next) => events.push(next))

    emit('active')
    await flushMicrotasks()

    expect(events).toEqual([])
    expect(getLifecycle()).toBe('foreground')
  })

  it('active -> background fires lifecycle; focus does NOT fire', async () => {
    const events: Array<{ next: string; prev: string }> = []
    const focusFires: number[] = []
    addLifecycleListener((next, prev) => events.push({ next, prev }))
    addForegroundFocusListener(() => focusFires.push(1))

    emit('background')
    await flushMicrotasks()

    expect(events).toEqual([{ next: 'background', prev: 'foreground' }])
    expect(focusFires).toEqual([])
    expect(getLifecycle()).toBe('background')
  })

  it('background -> active fires lifecycle synchronously, focus on next microtask', async () => {
    resetAll('background')

    const trace: string[] = []
    addLifecycleListener(() => trace.push('lifecycle'))
    addForegroundFocusListener(() => trace.push('focus'))

    emit('active')
    // Synchronously after emit: lifecycle ran, focus has not.
    expect(trace).toEqual(['lifecycle'])

    await flushMicrotasks()

    expect(trace).toEqual(['lifecycle', 'focus'])
    expect(getLifecycle()).toBe('foreground')
  })

  it('background -> inactive -> active fires ONE transition (intermediate inactive collapses)', async () => {
    resetAll('background')

    const events: Array<{ next: string; prev: string }> = []
    const focusFires: number[] = []
    addLifecycleListener((next, prev) => events.push({ next, prev }))
    addForegroundFocusListener(() => focusFires.push(1))

    emit('inactive')
    emit('active')
    await flushMicrotasks()

    expect(events).toEqual([{ next: 'foreground', prev: 'background' }])
    expect(focusFires).toEqual([1])
  })

  it('repeated emits of the same state are no-ops', async () => {
    const events: string[] = []
    const focusFires: number[] = []
    addLifecycleListener((next) => events.push(next))
    addForegroundFocusListener(() => focusFires.push(1))

    emit('background')
    emit('background')
    emit('background')
    await flushMicrotasks()

    expect(events).toEqual(['background'])
    expect(focusFires).toEqual([])
  })

  it('foreground state changes fire focus exactly once per transition', async () => {
    resetAll('background')

    const focusFires: number[] = []
    addForegroundFocusListener(() => focusFires.push(1))

    // One real foreground transition.
    emit('active')
    // Plus a flicker that's not a transition.
    emit('inactive')
    emit('active')
    await flushMicrotasks()

    expect(focusFires).toEqual([1])
  })

  it('unknown maps to background', async () => {
    const events: Array<{ next: string; prev: string }> = []
    addLifecycleListener((next, prev) => events.push({ next, prev }))

    emit('unknown')
    await flushMicrotasks()

    expect(events).toEqual([{ next: 'background', prev: 'foreground' }])
    expect(getLifecycle()).toBe('background')
  })
})

describe('listener subscription', () => {
  it('multiple listeners all fire; unsubscribing one does not affect others', () => {
    const a: string[] = []
    const b: string[] = []
    const unsubA = addLifecycleListener((next) => a.push(next))
    addLifecycleListener((next) => b.push(next))

    emit('background')
    expect(a).toEqual(['background'])
    expect(b).toEqual(['background'])

    unsubA()
    emit('active')

    expect(a).toEqual(['background'])
    expect(b).toEqual(['background', 'foreground'])
  })

  it('focus listener can be unsubscribed', async () => {
    resetAll('background')

    const fires: number[] = []
    const unsub = addForegroundFocusListener(() => fires.push(1))

    emit('active')
    await flushMicrotasks()
    expect(fires).toEqual([1])

    unsub()
    resetAll('background') // keep lifecycle alive but reset for second cycle
    addForegroundFocusListener(() => {}) // dummy to keep subscription alive
    emit('active')
    await flushMicrotasks()

    expect(fires).toEqual([1])
  })

  it('a listener that subscribes during dispatch does NOT fire for the current transition', () => {
    const events: string[] = []
    addLifecycleListener(() => {
      addLifecycleListener(() => events.push('late'))
      events.push('first')
    })

    emit('background')

    // Snapshot iteration: only the original listener fires for this
    // transition. The newly-added 'late' listener is captured for FUTURE
    // events but not invoked synchronously here.
    expect(events).toEqual(['first'])
  })

  it('a listener that unsubscribes another mid-dispatch: the other still fires (snapshot)', () => {
    const events: string[] = []
    let unsubB: (() => void) | null = null
    addLifecycleListener(() => {
      events.push('a')
      unsubB?.()
    })
    unsubB = addLifecycleListener(() => events.push('b'))

    emit('background')

    // Both fire on this transition (snapshot before iteration); B is
    // gone for future transitions.
    expect(events).toEqual(['a', 'b'])

    emit('active')
    expect(events).toEqual(['a', 'b', 'a'])
  })
})

describe('listener error safety', () => {
  it('a throwing lifecycle listener does NOT prevent later listeners from running', () => {
    const events: string[] = []
    addLifecycleListener(() => {
      throw new Error('boom')
    })
    addLifecycleListener(() => events.push('survived'))

    emit('background')

    expect(events).toEqual(['survived'])
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'lifecycle',
      'listener_error',
      expect.objectContaining({ kind: 'lifecycle' }),
    )
  })

  it('a throwing lifecycle listener does NOT prevent the focus signal from firing', async () => {
    resetAll('background')

    addLifecycleListener(() => {
      throw new Error('boom')
    })
    const focusFires: number[] = []
    addForegroundFocusListener(() => focusFires.push(1))

    emit('active')
    await flushMicrotasks()

    expect(focusFires).toEqual([1])
  })

  it('a throwing focus listener does NOT prevent later focus listeners', async () => {
    resetAll('background')

    const events: string[] = []
    addForegroundFocusListener(() => {
      throw new Error('focus boom')
    })
    addForegroundFocusListener(() => events.push('survived'))

    emit('active')
    await flushMicrotasks()

    expect(events).toEqual(['survived'])
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'lifecycle',
      'listener_error',
      expect.objectContaining({ kind: 'focus' }),
    )
  })
})

describe('initLifecycle', () => {
  it('is idempotent — calling twice does not double-subscribe', () => {
    resetAll('active')

    initLifecycle()
    initLifecycle()

    expect(mockListeners).toHaveLength(1)
  })

  it('teardown removes the AppState subscription', () => {
    initLifecycle()
    expect(mockListeners).toHaveLength(1)
    __resetLifecycleForTesting()

    expect(mockRemove).toHaveBeenCalledTimes(1)
  })

  it('teardown clears listeners so re-init starts clean', async () => {
    const events: string[] = []
    addLifecycleListener((next) => events.push(`first:${next}`))

    resetAll('active')

    addLifecycleListener((next) => events.push(`second:${next}`))
    emit('background')

    // The first-cycle listener is gone; only the second-cycle listener
    // sees this event.
    expect(events).toEqual(['second:background'])
  })

  it('addLifecycleListener auto-inits when called before initLifecycle', () => {
    resetAll('active')

    expect(mockListeners).toHaveLength(0)
    addLifecycleListener(() => {})
    expect(mockListeners).toHaveLength(1)
  })

  it('addForegroundFocusListener auto-inits when called before initLifecycle', () => {
    resetAll('active')

    expect(mockListeners).toHaveLength(0)
    addForegroundFocusListener(() => {})
    expect(mockListeners).toHaveLength(1)
  })
})
