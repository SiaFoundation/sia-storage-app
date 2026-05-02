import { createSuspensionManager, type SuspensionAdapters } from './suspension'

type Mocks = {
  scheduler: { [K in keyof SuspensionAdapters['scheduler']]: jest.Mock }
  uploader: { [K in keyof SuspensionAdapters['uploader']]: jest.Mock }
  hooks: { [K in keyof NonNullable<SuspensionAdapters['hooks']>]: jest.Mock }
}

function createAdapters(
  opts: {
    trace?: string[]
    uploaderSuspend?: () => Promise<void> | void
    onBeforeSuspend?: () => void | Promise<void>
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
    hooks: {
      onBeforeSuspend: jest.fn(opts.onBeforeSuspend ?? recordEvent('onBeforeSuspend')),
      onAfterResume: jest.fn(),
      onForegroundActive: jest.fn(),
    },
  }
  return {
    adapters: { scheduler: mocks.scheduler, uploader: mocks.uploader, hooks: mocks.hooks },
    mocks,
  }
}

describe('doSuspend', () => {
  it('runs flag flips + onBeforeSuspend in order, then marks suspended', async () => {
    const trace: string[] = []
    const { adapters, mocks } = createAdapters({ trace })
    const manager = createSuspensionManager(adapters)

    await manager.suspend()

    expect(trace).toEqual(['pause', 'abort', 'uploader.suspend', 'onBeforeSuspend'])
    expect(manager.isSuspended()).toBe(true)
    expect(mocks.hooks.onBeforeSuspend).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when not active', async () => {
    const { adapters, mocks } = createAdapters()
    const manager = createSuspensionManager(adapters)
    await manager.suspend()
    mocks.scheduler.pause.mockClear()

    await manager.suspend()

    expect(mocks.scheduler.pause).not.toHaveBeenCalled()
  })

  it('rolls back to active when onBeforeSuspend throws', async () => {
    const { adapters, mocks } = createAdapters({
      onBeforeSuspend: () => {
        throw new Error('boom')
      },
    })
    const manager = createSuspensionManager(adapters)

    await manager.suspend()

    expect(manager.isSuspended()).toBe(false)
    expect(mocks.scheduler.resume).toHaveBeenCalledTimes(1)
    expect(mocks.uploader.resume).toHaveBeenCalledTimes(1)
  })
})

describe('doResume', () => {
  it('restores services and runs onAfterResume', async () => {
    const { adapters, mocks } = createAdapters()
    const manager = createSuspensionManager(adapters)
    await manager.suspend()

    await manager.resume()

    expect(manager.isSuspended()).toBe(false)
    expect(mocks.hooks.onAfterResume).toHaveBeenCalledTimes(1)
    expect(mocks.uploader.adjustBatchForSuspension).toHaveBeenCalledTimes(1)
    expect(mocks.uploader.resume).toHaveBeenCalledTimes(1)
    expect(mocks.scheduler.resume).toHaveBeenCalledTimes(1)
  })

  it('only adjusts batch when not suspended', async () => {
    const { adapters, mocks } = createAdapters()
    const manager = createSuspensionManager(adapters)

    await manager.resume()

    expect(mocks.uploader.adjustBatchForSuspension).toHaveBeenCalledTimes(1)
    expect(mocks.hooks.onAfterResume).not.toHaveBeenCalled()
    expect(mocks.uploader.resume).not.toHaveBeenCalled()
    expect(mocks.scheduler.resume).not.toHaveBeenCalled()
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
    let releaseHook: () => void = () => {}
    const blocked = new Promise<void>((r) => {
      releaseHook = r
    })
    const { adapters, mocks } = createAdapters({ onBeforeSuspend: () => blocked })
    const manager = createSuspensionManager(adapters)

    const suspendPromise = manager.setAppState('background')
    const resumePromise = manager.setAppState('foreground')
    releaseHook()
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
