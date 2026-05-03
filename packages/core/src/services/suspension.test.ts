import { createSuspensionManager, type SuspensionAdapters } from './suspension'

type Mocks = {
  scheduler: { [K in keyof SuspensionAdapters['scheduler']]-?: jest.Mock }
  uploader: { [K in keyof SuspensionAdapters['uploader']]-?: jest.Mock }
  db: { [K in keyof SuspensionAdapters['db']]-?: jest.Mock }
  platform: { [K in keyof SuspensionAdapters['platform']]-?: jest.Mock }
  hooks: { [K in keyof NonNullable<SuspensionAdapters['hooks']>]-?: jest.Mock }
}

function createAdapters(
  opts: {
    trace?: string[]
    uploaderSuspend?: () => Promise<void> | void
    onAfterSuspend?: () => void | Promise<void>
    waitForIdle?: () => Promise<void>
    /** Returns iOS remaining ms; defaults to Infinity (no cap). */
    getBackgroundTimeRemainingMs?: () => number
  } = {},
): { adapters: SuspensionAdapters; mocks: Mocks } {
  const trace = opts.trace
  const recordEvent = (name: string) => () => {
    if (trace) trace.push(name)
  }
  const mocks: Mocks = {
    scheduler: {
      pause: jest.fn(recordEvent('pause')),
      abort: jest.fn(recordEvent('abort')),
      resume: jest.fn(recordEvent('resume')),
    },
    uploader: {
      suspend: jest.fn(opts.uploaderSuspend ?? recordEvent('uploader.suspend')),
      resume: jest.fn(),
      adjustBatchForSuspension: jest.fn(),
    },
    db: {
      gate: jest.fn(recordEvent('gate')),
      ungate: jest.fn(recordEvent('ungate')),
      waitForIdle: jest.fn(
        opts.waitForIdle ??
          (() => {
            if (trace) trace.push('waitForIdle')
            return Promise.resolve()
          }),
      ),
      interrupt: jest.fn(recordEvent('interrupt')),
      getInflightCount: jest.fn(() => 0),
    },
    platform: {
      getBackgroundTimeRemainingMs: jest.fn(
        opts.getBackgroundTimeRemainingMs ?? (() => Number.POSITIVE_INFINITY),
      ),
    },
    hooks: {
      onAfterSuspend: jest.fn(opts.onAfterSuspend ?? recordEvent('onAfterSuspend')),
      onAfterResume: jest.fn(),
      onForegroundActive: jest.fn(),
    },
  }
  return {
    adapters: {
      scheduler: mocks.scheduler,
      uploader: mocks.uploader,
      db: mocks.db,
      platform: mocks.platform,
      hooks: mocks.hooks,
    },
    mocks,
  }
}

// Suspension's fire-and-forget onAfterSuspend hook runs on the microtask
// queue after suspend() returns; the IIFE wrapper adds one extra await
// before the hook body runs. Two flushes drains both.
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('doSuspend', () => {
  it('gates DB, pauses services, drains, marks suspended, then fires onAfterSuspend', async () => {
    const trace: string[] = []
    const { adapters, mocks } = createAdapters({ trace })
    const manager = createSuspensionManager(adapters)

    await manager.suspend()
    await flushMicrotasks()

    expect(trace).toEqual([
      'gate',
      'pause',
      'abort',
      'uploader.suspend',
      'waitForIdle',
      'onAfterSuspend',
    ])
    expect(manager.isSuspended()).toBe(true)
    expect(mocks.hooks.onAfterSuspend).toHaveBeenCalledTimes(1)
    expect(mocks.db.interrupt).not.toHaveBeenCalled()
  })

  it('is a no-op when not active', async () => {
    const { adapters, mocks } = createAdapters()
    const manager = createSuspensionManager(adapters)
    await manager.suspend()
    mocks.scheduler.pause.mockClear()
    mocks.db.gate.mockClear()

    await manager.suspend()

    expect(mocks.scheduler.pause).not.toHaveBeenCalled()
    expect(mocks.db.gate).not.toHaveBeenCalled()
  })

  it('rolls back to active when uploader.suspend throws', async () => {
    const { adapters, mocks } = createAdapters({
      uploaderSuspend: () => {
        throw new Error('boom')
      },
    })
    const manager = createSuspensionManager(adapters)

    await manager.suspend()

    expect(manager.isSuspended()).toBe(false)
    expect(mocks.db.ungate).toHaveBeenCalledTimes(1)
    expect(mocks.scheduler.resume).toHaveBeenCalledTimes(1)
    expect(mocks.uploader.resume).toHaveBeenCalledTimes(1)
  })

  it('still marks suspended when onAfterSuspend throws (fire-and-forget)', async () => {
    const { adapters } = createAdapters({
      onAfterSuspend: () => {
        throw new Error('hook boom')
      },
    })
    const manager = createSuspensionManager(adapters)

    await manager.suspend()
    await flushMicrotasks()

    expect(manager.isSuspended()).toBe(true)
  })

  describe('interrupt loop', () => {
    it('calls interrupt while waitForIdle stays pending, breaks once it resolves', async () => {
      jest.useFakeTimers()
      try {
        let pendingResolver: () => void = () => {}
        const idle = jest
          .fn<Promise<void>, []>()
          // Stay pending for the first iteration so the loop calls interrupt.
          .mockImplementationOnce(
            () =>
              new Promise<void>((r) => {
                pendingResolver = r
              }),
          )
          // Resolve immediately on the second iteration so the loop breaks.
          .mockImplementation(() => Promise.resolve())

        const { adapters, mocks } = createAdapters({ waitForIdle: idle })
        const manager = createSuspensionManager(adapters)

        const suspendPromise = manager.suspend()

        // Drive the loop's INTERRUPT_TICK_MS (50ms) timer; the first
        // raceWithTimeout times out, an interrupt fires, and the loop
        // re-checks idle on the next iteration.
        await jest.advanceTimersByTimeAsync(50)
        pendingResolver()

        await suspendPromise
        await flushMicrotasks()

        expect(mocks.db.interrupt).toHaveBeenCalled()
        expect(manager.isSuspended()).toBe(true)
      } finally {
        jest.useRealTimers()
      }
    })

    it('bails when iOS background-time budget drops below FINISH_RESERVE_MS', async () => {
      jest.useFakeTimers()
      try {
        // Always-pending idle so the only way out is the dynamic budget.
        const pending: Array<() => void> = []
        const idle = jest.fn<Promise<void>, []>(
          () =>
            new Promise<void>((r) => {
              pending.push(r)
            }),
        )
        // 100ms reported remaining is below the 200ms FINISH_RESERVE_MS.
        // The drain order per iteration is `waitForIdle → budget check →
        // interrupt`, so the budget check trips before any interrupt fires.
        const { adapters, mocks } = createAdapters({
          waitForIdle: idle,
          getBackgroundTimeRemainingMs: () => 100,
        })
        const manager = createSuspensionManager(adapters)

        const suspendPromise = manager.suspend()

        await jest.advanceTimersByTimeAsync(50)
        for (const r of pending) r()

        await suspendPromise
        await flushMicrotasks()

        expect(manager.isSuspended()).toBe(true)
        expect(mocks.db.interrupt).not.toHaveBeenCalled()
        expect(mocks.platform.getBackgroundTimeRemainingMs).toHaveBeenCalled()
      } finally {
        jest.useRealTimers()
      }
    })

    it('bails on MAX_DRAIN_MS when iOS budget is Infinity but inflight never drains', async () => {
      jest.useFakeTimers()
      try {
        // waitForIdle is always pending → only static MAX_DRAIN_MS can
        // exit the loop. iOS budget reads Infinity (foreground / pre-
        // suspension grace), which JSON.stringifies to null in logs.
        const pending: Array<() => void> = []
        const idle = jest.fn<Promise<void>, []>(
          () =>
            new Promise<void>((r) => {
              pending.push(r)
            }),
        )
        const { adapters, mocks } = createAdapters({
          waitForIdle: idle,
          getBackgroundTimeRemainingMs: () => Number.POSITIVE_INFINITY,
        })
        const manager = createSuspensionManager(adapters, {
          initialAppState: 'background',
        })

        const suspendPromise = manager.suspend()

        // MAX_DRAIN_MS = 5_000.
        await jest.advanceTimersByTimeAsync(5_000)
        for (const r of pending) r()

        await suspendPromise
        await flushMicrotasks()

        expect(manager.isSuspended()).toBe(true)
        expect(mocks.db.interrupt).toHaveBeenCalled()
      } finally {
        jest.useRealTimers()
      }
    })

    it('aborts mid-drain when foreground arrives', async () => {
      jest.useFakeTimers()
      try {
        // Always-pending waitForIdle so the loop can only exit on the
        // foreground-abort check at the top of the iteration.
        const pending: Array<() => void> = []
        const idle = jest.fn<Promise<void>, []>(
          () =>
            new Promise<void>((r) => {
              pending.push(r)
            }),
        )
        const { adapters, mocks } = createAdapters({ waitForIdle: idle })
        // Start in background so the suspend actually runs (rather than
        // being skipped by the foreground guard up front).
        const manager = createSuspensionManager(adapters, {
          initialAppState: 'background',
        })

        const suspendPromise = manager.suspend()

        // Let a couple of interrupt iterations run.
        await jest.advanceTimersByTimeAsync(150)
        const interruptsBeforeForeground = mocks.db.interrupt.mock.calls.length
        expect(interruptsBeforeForeground).toBeGreaterThan(0)

        // Flip appState directly. setAppState would also enqueue a
        // doResume which would deadlock against the running doSuspend
        // (waitForIdle is pinned pending), so we drive the appState
        // mutation through the synchronous path that setAppState uses
        // internally — calling setAppState('foreground') sync-mutates
        // appState before its returned Promise settles.
        void manager.setAppState('foreground')

        // The next iteration of drainDb (within INTERRUPT_TICK_MS = 50ms)
        // sees appState !== 'background' and bails.
        await jest.advanceTimersByTimeAsync(50)
        // Resolve any leftover idle promise so the no-op catch settles.
        for (const r of pending) r()

        await suspendPromise
        await flushMicrotasks()

        // No further interrupts after the abort.
        const interruptsAfterAbort = mocks.db.interrupt.mock.calls.length
        await jest.advanceTimersByTimeAsync(2_000)
        expect(mocks.db.interrupt.mock.calls.length).toBe(interruptsAfterAbort)
      } finally {
        jest.useRealTimers()
      }
    })

    it('keeps interrupting while iOS budget is generous, until idle', async () => {
      jest.useFakeTimers()
      try {
        // Three pending iterations, then a resolved one. With 30s reported
        // remaining we should see three interrupts before the drain ends.
        const pending: Array<() => void> = []
        let calls = 0
        const idle = jest.fn<Promise<void>, []>(() => {
          calls += 1
          if (calls <= 3) {
            return new Promise<void>((r) => {
              pending.push(r)
            })
          }
          return Promise.resolve()
        })
        const { adapters, mocks } = createAdapters({
          waitForIdle: idle,
          getBackgroundTimeRemainingMs: () => 30_000,
        })
        const manager = createSuspensionManager(adapters)

        const suspendPromise = manager.suspend()

        // 3 ticks @ 50ms = 150ms; the 4th idle resolves immediately.
        await jest.advanceTimersByTimeAsync(150)
        for (const r of pending) r()

        await suspendPromise
        await flushMicrotasks()

        expect(mocks.db.interrupt).toHaveBeenCalledTimes(3)
        expect(manager.isSuspended()).toBe(true)
      } finally {
        jest.useRealTimers()
      }
    })
  })
})

describe('doResume', () => {
  it('runs onAfterResume, then ungates DB, then restores services', async () => {
    const trace: string[] = []
    const { adapters, mocks } = createAdapters({ trace })
    mocks.hooks.onAfterResume.mockImplementation(() => {
      trace.push('onAfterResume')
    })
    mocks.uploader.resume.mockImplementation(() => {
      trace.push('uploader.resume')
    })
    const manager = createSuspensionManager(adapters)
    await manager.suspend()
    await flushMicrotasks()
    trace.length = 0

    await manager.resume()

    expect(trace).toEqual(['onAfterResume', 'ungate', 'uploader.resume', 'resume'])
    expect(manager.isSuspended()).toBe(false)
    expect(mocks.uploader.adjustBatchForSuspension).toHaveBeenCalledTimes(1)
  })

  it('only adjusts batch when not suspended', async () => {
    const { adapters, mocks } = createAdapters()
    const manager = createSuspensionManager(adapters)

    await manager.resume()

    expect(mocks.uploader.adjustBatchForSuspension).toHaveBeenCalledTimes(1)
    expect(mocks.hooks.onAfterResume).not.toHaveBeenCalled()
    expect(mocks.db.ungate).not.toHaveBeenCalled()
    expect(mocks.uploader.resume).not.toHaveBeenCalled()
    expect(mocks.scheduler.resume).not.toHaveBeenCalled()
  })
})

describe('initialAppState option', () => {
  it("defaults to 'foreground' so suspend on first BG release is gated", async () => {
    const { adapters } = createAdapters()
    const manager = createSuspensionManager(adapters)

    await manager.registerBackgroundTask('bg')
    await manager.releaseBackgroundTask('bg')

    expect(manager.isSuspended()).toBe(false)
  })

  it("'background' lets the first BG release suspend without an AppState event", async () => {
    const { adapters } = createAdapters()
    const manager = createSuspensionManager(adapters, { initialAppState: 'background' })

    await manager.registerBackgroundTask('bg')
    await manager.releaseBackgroundTask('bg')

    expect(manager.isSuspended()).toBe(true)
  })
})

describe('BG task gating', () => {
  it('blocks suspend while a BG task is running', async () => {
    const { adapters, mocks } = createAdapters()
    const manager = createSuspensionManager(adapters)

    await manager.registerBackgroundTask('bg')
    await manager.setAppState('background')

    expect(manager.isSuspended()).toBe(false)
    expect(mocks.scheduler.pause).not.toHaveBeenCalled()
  })

  it('suspends when the last BG task releases and app is backgrounded', async () => {
    const { adapters } = createAdapters()
    const manager = createSuspensionManager(adapters)

    await manager.setAppState('background')
    await manager.registerBackgroundTask('bg')
    await manager.releaseBackgroundTask('bg')

    expect(manager.isSuspended()).toBe(true)
  })

  it('does not suspend on release when app is foregrounded', async () => {
    const { adapters } = createAdapters()
    const manager = createSuspensionManager(adapters)

    await manager.registerBackgroundTask('bg')
    await manager.releaseBackgroundTask('bg')

    expect(manager.isSuspended()).toBe(false)
  })
})

describe('AppState transitions', () => {
  it('cycles foreground → background → foreground cleanly', async () => {
    const { adapters } = createAdapters()
    const manager = createSuspensionManager(adapters)

    await manager.setAppState('background')
    expect(manager.isSuspended()).toBe(true)

    await manager.setAppState('foreground')
    expect(manager.isSuspended()).toBe(false)
  })

  it('serializes a foreground that arrives mid-suspend via the queue', async () => {
    let releaseDrain: () => void = () => {}
    const blocked = new Promise<void>((r) => {
      releaseDrain = r
    })
    // Park the drain so the suspend Promise stays pending while the
    // foreground call slots in behind it on the coalescing queue.
    const { adapters, mocks } = createAdapters({ waitForIdle: () => blocked })
    const manager = createSuspensionManager(adapters)

    const suspendPromise = manager.setAppState('background')
    const resumePromise = manager.setAppState('foreground')
    releaseDrain()
    await suspendPromise
    await resumePromise

    expect(mocks.hooks.onAfterResume).toHaveBeenCalledTimes(1)
    expect(manager.isSuspended()).toBe(false)
  })
})

describe('onForegroundActive hook', () => {
  it('fires on every foreground call, including no-ops and BG-task overlaps', async () => {
    const { adapters, mocks } = createAdapters()
    const manager = createSuspensionManager(adapters)

    // No-op foreground (already foreground): fires the hook anyway.
    await manager.setAppState('foreground')
    expect(mocks.hooks.onForegroundActive).toHaveBeenCalledTimes(1)
    expect(mocks.hooks.onAfterResume).not.toHaveBeenCalled()

    // Real cycle: foreground → background → foreground.
    await manager.setAppState('background')
    await manager.setAppState('foreground')
    expect(mocks.hooks.onForegroundActive).toHaveBeenCalledTimes(2)
    expect(mocks.hooks.onAfterResume).toHaveBeenCalledTimes(1)

    // BG-task wake from suspended: onAfterResume fires, foreground hook does not (appState stays 'background').
    await manager.setAppState('background')
    await manager.registerBackgroundTask('bg')
    expect(mocks.hooks.onAfterResume).toHaveBeenCalledTimes(2)
    expect(mocks.hooks.onForegroundActive).toHaveBeenCalledTimes(2)

    // User foregrounds while BG task still running: onAfterResume does NOT
    // fire again (manager is already resumed); onForegroundActive must.
    await manager.setAppState('foreground')
    expect(mocks.hooks.onAfterResume).toHaveBeenCalledTimes(2)
    expect(mocks.hooks.onForegroundActive).toHaveBeenCalledTimes(3)
  })

  it('does not fire on background calls', async () => {
    const { adapters, mocks } = createAdapters()
    const manager = createSuspensionManager(adapters)

    await manager.setAppState('background')
    await manager.setAppState('background')

    expect(mocks.hooks.onForegroundActive).not.toHaveBeenCalled()
  })
})
