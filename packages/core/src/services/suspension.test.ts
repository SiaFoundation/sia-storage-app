import { createSuspensionManager, type SuspensionAdapters } from './suspension'

function createAdapters(overrides?: {
  schedulerWaitForIdle?: () => Promise<void>
  dbWaitForIdle?: () => Promise<void>
  dbClose?: () => Promise<void>
  hardDeadlineMs?: number
}): {
  adapters: SuspensionAdapters
  scheduler: SuspensionAdapters['scheduler']
  db: SuspensionAdapters['db']
  uploader: SuspensionAdapters['uploader']
} {
  const scheduler: SuspensionAdapters['scheduler'] = {
    pause: jest.fn(),
    abort: jest.fn(),
    resume: jest.fn(),
    waitForIdle: jest.fn(overrides?.schedulerWaitForIdle ?? (() => Promise.resolve())),
  }
  const uploader: SuspensionAdapters['uploader'] = {
    suspend: jest.fn(() => Promise.resolve()),
    resume: jest.fn(),
    adjustBatchForSuspension: jest.fn(),
    getDiagnostics: jest.fn(() => ({
      isSuspended: false,
      batchId: null,
      filesInBatch: 0,
      hasPacker: false,
      finalizing: false,
    })),
  }
  const db: SuspensionAdapters['db'] = {
    gate: jest.fn(),
    ungate: jest.fn(),
    waitForIdle: jest.fn(overrides?.dbWaitForIdle ?? (() => Promise.resolve())),
    close: jest.fn(overrides?.dbClose ?? (() => Promise.resolve())),
    reopen: jest.fn(() => Promise.resolve()),
  }
  const adapters: SuspensionAdapters = {
    scheduler,
    uploader,
    db,
    hardDeadlineMs: overrides?.hardDeadlineMs ?? 100,
  }
  return { adapters, scheduler, db, uploader }
}

describe('createSuspensionManager deadline behavior', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('reaches suspended even when scheduler.waitForIdle never resolves', async () => {
    const { adapters, db } = createAdapters({
      schedulerWaitForIdle: () => new Promise(() => {}),
      hardDeadlineMs: 100,
    })
    const manager = createSuspensionManager(adapters)

    const suspendPromise = manager.suspend()
    await jest.advanceTimersByTimeAsync(500)
    await suspendPromise

    expect(manager.isSuspended()).toBe(true)
    expect(db.gate).toHaveBeenCalled()
    expect(db.close).toHaveBeenCalled()
  })

  it('reaches suspended even when db.waitForIdle never resolves', async () => {
    const { adapters, db } = createAdapters({
      dbWaitForIdle: () => new Promise(() => {}),
      hardDeadlineMs: 100,
    })
    const manager = createSuspensionManager(adapters)

    const suspendPromise = manager.suspend()
    await jest.advanceTimersByTimeAsync(2000)
    await suspendPromise

    expect(manager.isSuspended()).toBe(true)
    expect(db.close).toHaveBeenCalled()
  })

  it('reaches suspended even when db.close never resolves', async () => {
    const { adapters } = createAdapters({
      dbClose: () => new Promise(() => {}),
      hardDeadlineMs: 100,
    })
    const manager = createSuspensionManager(adapters)

    const suspendPromise = manager.suspend()
    await jest.advanceTimersByTimeAsync(5000)
    await suspendPromise

    expect(manager.isSuspended()).toBe(true)
  })
})

describe('createSuspensionManager onForegroundActive hook', () => {
  it('fires on every setAppState(foreground) call, including no-ops', async () => {
    const onForegroundActive = jest.fn()
    const onAfterResume = jest.fn()
    const { adapters } = createAdapters()
    const manager = createSuspensionManager({
      ...adapters,
      hooks: { onForegroundActive, onAfterResume },
    })

    // Initial appState is 'foreground'. setAppState('foreground') with no
    // transition still fires the hook — matches iOS 'inactive' → 'active'
    // flicker semantics where 'active' events should refresh SWR even
    // when the manager never thought we were 'background'.
    await manager.setAppState('foreground')
    expect(onForegroundActive).toHaveBeenCalledTimes(1)
    expect(onAfterResume).not.toHaveBeenCalled()

    // Real cycle: foreground → background → foreground.
    await manager.setAppState('background')
    expect(onForegroundActive).toHaveBeenCalledTimes(1)
    await manager.setAppState('foreground')
    expect(onForegroundActive).toHaveBeenCalledTimes(2)
    expect(onAfterResume).toHaveBeenCalledTimes(1)

    // BG-task wake from suspended fires onAfterResume but not the
    // foreground hook — appState stays 'background'.
    await manager.setAppState('background')
    await manager.registerBackgroundTask('bg')
    expect(onAfterResume).toHaveBeenCalledTimes(2)
    expect(onForegroundActive).toHaveBeenCalledTimes(2)

    // User foregrounds while BG task is still running. The manager is
    // already resumed so onAfterResume does NOT fire again, but
    // onForegroundActive must — that's the whole reason this hook exists.
    await manager.setAppState('foreground')
    expect(onAfterResume).toHaveBeenCalledTimes(2)
    expect(onForegroundActive).toHaveBeenCalledTimes(3)
  })

  it('does not fire on setAppState(background) calls', async () => {
    const onForegroundActive = jest.fn()
    const { adapters } = createAdapters()
    const manager = createSuspensionManager({
      ...adapters,
      hooks: { onForegroundActive },
    })
    await manager.setAppState('background')
    await manager.setAppState('background')
    expect(onForegroundActive).not.toHaveBeenCalled()
  })
})
