const mockPlatform = { OS: 'android', Version: 34 }
const mockRequestPermission = jest.fn(async (_permission: string) => 'granted')
// Read through getters: the factory runs before this file's constants exist.
jest.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mockPlatform.OS
    },
    get Version() {
      return mockPlatform.Version
    },
  },
  PermissionsAndroid: {
    PERMISSIONS: { POST_NOTIFICATIONS: 'android.permission.POST_NOTIFICATIONS' },
    RESULTS: { GRANTED: 'granted', DENIED: 'denied' },
    request: (permission: string) => mockRequestPermission(permission),
  },
}))

const mockService = {
  running: false,
  start: jest.fn(),
  update: jest.fn(),
  stop: jest.fn(),
  onTimeout: null as null | (() => void),
  onStopped: null as null | (() => void),
  onRefused: null as null | (() => void),
}
jest.mock('upload-service', () => ({
  START_NOT_ALLOWED: 'start-not-allowed',
  isUploadServiceRunning: () => mockService.running,
  startUploadService: (c: unknown) => {
    mockService.start(c)
    mockService.running = true
  },
  updateUploadService: (c: unknown) => mockService.update(c),
  stopUploadService: () => {
    mockService.stop()
    mockService.running = false
  },
  addUploadServiceTimeoutListener: (fn: () => void) => {
    mockService.onTimeout = fn
    return { remove: () => {} }
  },
  addUploadServiceStoppedListener: (fn: () => void) => {
    mockService.onStopped = fn
    return { remove: () => {} }
  },
  addUploadServiceRefusedListener: (fn: () => void) => {
    mockService.onRefused = fn
    return { remove: () => {} }
  },
}))

const mockWorld = {
  enabled: true,
  network: { isConnected: true, type: 'wifi', details: { isConnectionExpensive: false } },
  pending: 0,
  activeUploads: [] as string[],
  importing: 0,
  thumbs: 0,
  uploadedBytes: 0,
  packedBytes: 0,
  shardBytes: 0,
  importingGate: null as null | Promise<void>,
  lifecycle: 'foreground' as 'foreground' | 'background',
  lifecycleListener: null as null | ((next: string) => void),
  libraryListener: null as null | (() => void),
}
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { fetch: async () => mockWorld.network },
}))
jest.mock('../stores/appService', () => ({
  app: () => ({
    storage: {
      getItem: async () => String(mockWorld.enabled),
      setItem: async () => {},
    },
    caches: {
      settings: { invalidate: () => {} },
      libraryVersion: {
        subscribe: (fn: () => void) => {
          mockWorld.libraryListener = fn
          return () => {}
        },
      },
    },
    thumbnails: {
      allowedTypes: [],
      queryProgress: async () => ({ originals: 0, thumbs: mockWorld.thumbs }),
    },
    uploads: { getActiveIds: () => mockWorld.activeUploads },
    imports: {
      countInFlight: async () => {
        if (mockWorld.importingGate) await mockWorld.importingGate
        return mockWorld.importing
      },
    },
  }),
  getUploadManager: () => ({
    uploadedBytes: mockWorld.uploadedBytes,
    packedBytes: mockWorld.packedBytes,
    shardBytes: mockWorld.shardBytes,
  }),
}))
jest.mock('../stores/files', () => ({
  getFileStatsLocal: async () => ({ count: mockWorld.pending }),
}))
jest.mock('./lifecycle', () => ({
  getLifecycle: () => mockWorld.lifecycle,
  addLifecycleListener: (fn: (next: string) => void) => {
    mockWorld.lifecycleListener = fn
    return () => {}
  },
}))
const mockRegister = jest.fn(async (_id: string) => {})
const mockRelease = jest.fn(async (_id: string) => {})
const mockPark = jest.fn(async () => {})
jest.mock('./suspension', () => ({
  registerBackgroundTaskLifecycle: (id: string) => mockRegister(id),
  releaseBackgroundTaskLifecycle: (id: string) => mockRelease(id),
  suspendForAndroidServiceStop: () => mockPark(),
}))

import { IDLE_STEADY_INTERVAL_MS } from './thumbnailScanner'
import { noteUploadWork } from './uploadWorkSignal'
import {
  __resetUploadForegroundServiceForTesting,
  __tickForTesting,
  FGS_TASK_ID,
  getUploadServiceState,
  initUploadForegroundService,
  LINGER_MS,
  setBackgroundUploadsEnabled,
  STALL_MS,
  shutdownUploadForegroundService,
} from './uploadForegroundService'

const tick = __tickForTesting
const advance = (ms: number) => jest.setSystemTime(Date.now() + ms)

beforeEach(() => {
  jest.useFakeTimers()
  jest.clearAllMocks()
  Object.assign(mockService, { running: false, onTimeout: null, onStopped: null, onRefused: null })
  Object.assign(mockWorld, {
    enabled: true,
    network: { isConnected: true, type: 'wifi', details: { isConnectionExpensive: false } },
    pending: 0,
    activeUploads: [],
    importing: 0,
    thumbs: 0,
    uploadedBytes: 0,
    packedBytes: 0,
    shardBytes: 0,
    importingGate: null,
    lifecycle: 'foreground',
  })
  Object.assign(mockPlatform, { OS: 'android', Version: 34 })
  mockRequestPermission.mockResolvedValue('granted')
  __resetUploadForegroundServiceForTesting()
})

afterEach(() => {
  __resetUploadForegroundServiceForTesting()
  jest.useRealTimers()
})

async function startRunning() {
  mockWorld.pending = 3
  initUploadForegroundService()
  await tick()
  expect(getUploadServiceState()).toBe('running')
}

describe('starting', () => {
  it('starts in the foreground on Wi-Fi with uploads pending, and holds off suspension', async () => {
    await startRunning()
    expect(mockService.start).toHaveBeenCalledTimes(1)
    expect(mockRegister).toHaveBeenCalledWith(FGS_TASK_ID)
  })

  it.each([
    ['the setting is off', () => (mockWorld.enabled = false)],
    ['the app is in the background', () => (mockWorld.lifecycle = 'background')],
    [
      'the network is cellular',
      () =>
        (mockWorld.network = {
          isConnected: true,
          type: 'cellular',
          details: { isConnectionExpensive: true },
        }),
    ],
    ['nothing is pending', () => (mockWorld.pending = 0)],
  ])('does not start when %s', async (_, arrange) => {
    mockWorld.pending = 3
    arrange()
    initUploadForegroundService()
    await tick()
    expect(mockService.start).not.toHaveBeenCalled()
  })

  it('starts as soon as files are added in front, without waiting for the next poll', async () => {
    initUploadForegroundService()
    await tick()
    expect(getUploadServiceState()).toBe('idle')

    mockWorld.pending = 3
    mockWorld.libraryListener?.()
    // Settles the poll the add started, well short of the next scheduled one.
    await jest.advanceTimersByTimeAsync(10)
    expect(getUploadServiceState()).toBe('running')
  })

  it('starts when an import is staged, which changes no library rows, without waiting for the next poll', async () => {
    initUploadForegroundService()
    await tick()
    mockWorld.importing = 1
    noteUploadWork()
    await jest.advanceTimersByTimeAsync(10)
    expect(getUploadServiceState()).toBe('running')
  })

  it('polls again when work arrives during a poll that already read the queue as empty', async () => {
    initUploadForegroundService()
    let release!: () => void
    mockWorld.importingGate = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = tick()
    await jest.advanceTimersByTimeAsync(0)
    // The poll read zero pending and now waits on the import count.
    mockWorld.pending = 3
    mockWorld.libraryListener?.()
    mockWorld.importingGate = null
    release()
    await first
    await jest.advanceTimersByTimeAsync(10)
    expect(getUploadServiceState()).toBe('running')
  })

  it('starts for an import still in flight with no upload queued yet', async () => {
    mockWorld.importing = 1
    initUploadForegroundService()
    await tick()
    expect(getUploadServiceState()).toBe('running')
  })

  it('starts for a file the uploader is sending that no longer counts as waiting', async () => {
    // A newer copy with its name made it an old version, which the waiting count skips.
    mockWorld.activeUploads = ['old-version']
    initUploadForegroundService()
    await tick()
    expect(getUploadServiceState()).toBe('running')
  })
})

describe('staying up', () => {
  it.each([
    ['uploaded bytes rise', () => (mockWorld.uploadedBytes += 1)],
    ['thumbnails are made', () => (mockWorld.thumbs += 1)],
  ])('stays up past the linger while %s, with nothing left queued', async (_, makeProgress) => {
    await startRunning()
    mockWorld.pending = 0
    for (let elapsed = 0; elapsed < LINGER_MS * 2; elapsed += 30_000) {
      advance(30_000)
      makeProgress()
      await tick()
    }
    // Never stopped, not stopped and started again: in the foreground with
    // work pending, the next poll would restart it.
    expect(mockService.stop).not.toHaveBeenCalled()
  })

  it('stays up past the stall limit while a large file uploads with no file finished', async () => {
    await startRunning()
    for (let elapsed = 0; elapsed < STALL_MS * 1.5; elapsed += 30_000) {
      advance(30_000)
      mockWorld.shardBytes += 40 * 1024 * 1024
      await tick()
    }
    expect(mockService.stop).not.toHaveBeenCalled()
  })

  it('stays up past the stall limit while imports keep finishing', async () => {
    mockWorld.importing = 100
    await startRunning()
    for (let elapsed = 0; elapsed < STALL_MS * 1.5; elapsed += 30_000) {
      advance(30_000)
      mockWorld.importing -= 1
      await tick()
    }
    // Never stopped, not stopped and started again: in the foreground with
    // work pending, the next poll would restart it.
    expect(mockService.stop).not.toHaveBeenCalled()
  })

  it('stays up with no progress while work is outstanding, until the stall limit', async () => {
    await startRunning()
    advance(LINGER_MS + 1)
    await tick()
    expect(getUploadServiceState()).toBe('running')
    advance(STALL_MS)
    await tick()
    expect(getUploadServiceState()).toBe('idle')
    expect(mockService.stop).toHaveBeenCalledTimes(1)
  })

  it('stops after the linger once nothing moves and nothing is left, even with thumbnails never made', async () => {
    await startRunning()
    mockWorld.pending = 0
    advance(LINGER_MS + 1)
    await tick()
    expect(getUploadServiceState()).toBe('idle')
    expect(mockRelease).toHaveBeenCalledWith(FGS_TASK_ID)
  })

  it('stays up past the linger while the uploader holds a file that no longer counts as waiting', async () => {
    await startRunning()
    mockWorld.pending = 0
    mockWorld.activeUploads = ['old-version']
    advance(LINGER_MS + 1)
    await tick()
    expect(getUploadServiceState()).toBe('running')
  })

  it('lingers longer than the thumbnail scanner waits between scans', () => {
    expect(LINGER_MS).toBeGreaterThan(IDLE_STEADY_INTERVAL_MS)
  })

  it('stops when the phone moves to cellular', async () => {
    await startRunning()
    mockWorld.network = {
      isConnected: true,
      type: 'cellular',
      details: { isConnectionExpensive: true },
    }
    await tick()
    expect(getUploadServiceState()).toBe('idle')
  })
})

describe('stopping', () => {
  it('parks the uploader when it stops in the background, and not in the foreground', async () => {
    await startRunning()
    mockWorld.pending = 0
    advance(LINGER_MS + 1)
    await tick()
    expect(mockPark).not.toHaveBeenCalled()

    await startRunningAgain()
    mockWorld.lifecycle = 'background'
    mockWorld.pending = 0
    advance(LINGER_MS + 1)
    await tick()
    expect(mockPark).toHaveBeenCalledTimes(1)
  })

  it('a spent budget waits for the next foreground, then can start again', async () => {
    await startRunning()
    mockService.running = false
    mockService.onTimeout?.()
    mockService.onStopped?.()
    await Promise.resolve()
    expect(getUploadServiceState()).toBe('waiting-for-foreground')
    await tick()
    expect(mockService.start).toHaveBeenCalledTimes(1)

    mockWorld.lifecycleListener?.('foreground')
    await jest.runOnlyPendingTimersAsync()
    expect(getUploadServiceState()).toBe('running')
  })

  it('shutting the app down stops a running service and lets suspension go', async () => {
    await startRunning()
    await shutdownUploadForegroundService()
    expect(mockService.stop).toHaveBeenCalledTimes(1)
    expect(mockRelease).toHaveBeenCalledWith(FGS_TASK_ID)
    expect(getUploadServiceState()).toBe('idle')
  })

  it('a start Android refuses after the call returned waits for the next foreground, as a spent budget does', async () => {
    await startRunning()
    mockService.running = false
    mockService.onRefused?.()
    mockService.onStopped?.()
    await Promise.resolve()
    expect(getUploadServiceState()).toBe('waiting-for-foreground')
    expect(mockRelease).toHaveBeenCalledWith(FGS_TASK_ID)
  })

  it('a service Android stopped behind our back is let go, with no restart in the background', async () => {
    await startRunning()
    mockWorld.lifecycle = 'background'
    mockService.running = false
    mockService.onStopped?.()
    await Promise.resolve()
    expect(getUploadServiceState()).toBe('idle')
    expect(mockRelease).toHaveBeenCalledWith(FGS_TASK_ID)
    await tick()
    expect(mockService.start).toHaveBeenCalledTimes(1)
  })
})

async function startRunningAgain() {
  mockWorld.pending = 3
  await tick()
  expect(getUploadServiceState()).toBe('running')
}

describe('the setting', () => {
  it('turning it on asks for notifications on Android 13 and up, and reports a refusal', async () => {
    mockRequestPermission.mockResolvedValue('denied')
    expect(await setBackgroundUploadsEnabled(true)).toBe(false)
    expect(mockRequestPermission).toHaveBeenCalledWith('android.permission.POST_NOTIFICATIONS')
  })

  it('does not ask below Android 13, where no permission is needed, or when turning it off', async () => {
    mockPlatform.Version = 32
    expect(await setBackgroundUploadsEnabled(true)).toBe(true)
    mockPlatform.Version = 34
    expect(await setBackgroundUploadsEnabled(false)).toBe(true)
    expect(mockRequestPermission).not.toHaveBeenCalled()
  })
})
