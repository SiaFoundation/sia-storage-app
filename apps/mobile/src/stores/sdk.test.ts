import { closeAuthBrowser, openAuthURL } from '../lib/openAuthUrl'
import { app, getMobileSdkAuth, internal } from './appService'
import * as sdkStore from './sdk'

// AppState mock
let mockAppStateListeners: Array<(state: string) => void> = []
const mockAppStateSubscription = { remove: jest.fn() }
const mockPlatform = { OS: 'ios' as string }

jest.mock('react-native', () => ({
  get Platform() {
    return mockPlatform
  },
  AppState: {
    addEventListener: jest.fn((_event: string, handler: (state: string) => void) => {
      mockAppStateListeners.push(handler)
      return mockAppStateSubscription
    }),
  },
}))

function expectCleanAuthState() {
  expect(app().connection.getState().isAuthing).toBe(false)
}
jest.mock('../lib/openAuthUrl', () => ({
  openAuthURL: jest.fn(),
  closeAuthBrowser: jest.fn(),
}))
jest.mock('@siastorage/logger', () => ({ logger: { log: jest.fn() } }))
jest.mock('@siastorage/core/config', () => ({ APP_KEY: '0'.repeat(64) }))

const mockOpenAuthURL = jest.mocked(openAuthURL)
const mockCloseAuthBrowser = jest.mocked(closeAuthBrowser)

let mockSetMnemonicHash: jest.SpyInstance
let mockValidateMnemonic: jest.SpyInstance
let _mockGetIndexerURL: jest.SpyInstance
let mockSetIndexerURL: jest.SpyInstance
let mockGetAppKey: jest.SpyInstance
let _mockBuilderCreate: jest.SpyInstance
let mockBuilderConnectWithKey: jest.SpyInstance
let mockBuilderRequestConnection: jest.SpyInstance
let mockBuilderWaitForApproval: jest.SpyInstance
let mockBuilderRegister: jest.SpyInstance
let mockBuilderCancel: jest.SpyInstance
let mockOnConnected: jest.SpyInstance
let _mockGetLastSdk: jest.SpyInstance

const BROWSER_CLOSE_GRACE_MS = 6_000

/**
 * Creates a mock for builder.waitForApproval() + cancel() that simulates
 * the real abort behavior. When cancel is called, the pending waitForApproval
 * rejects with an AbortError.
 *
 * - If resolveAfterMs is provided, resolves after that delay.
 * - If cancel() is called, rejects with AbortError.
 * - If neither, the promise never resolves.
 */
function createCancellableMock(resolveAfterMs?: number) {
  let calls = 0
  let cancelFn: (() => void) | null = null

  const waitImpl = () => {
    calls++
    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined

      cancelFn = () => {
        if (timer) clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      }

      if (resolveAfterMs !== undefined) {
        timer = setTimeout(() => {
          cancelFn = null
          resolve()
        }, resolveAfterMs)
      }
    })
  }

  const cancelImpl = () => {
    cancelFn?.()
    cancelFn = null
  }

  return { waitImpl, cancelImpl, callCount: () => calls }
}

const mockKeyBytes = new Uint8Array(32)
const mockKeyHex = '0'.repeat(64)
const mockAppKeyHex = '0'.repeat(128)

describe('sdk store', () => {
  let mockSdk: any

  beforeEach(() => {
    jest.clearAllMocks()
    sdkStore.resetSdk()

    mockPlatform.OS = 'ios'
    mockAppStateListeners = []
    mockAppStateSubscription.remove.mockClear()

    mockSdk = {
      object: jest.fn(),
      saveObject: jest.fn(),
      appKey: jest.fn(() => ({ export_: () => new ArrayBuffer(32) })),
      objectEvents: jest.fn().mockResolvedValue([]),
    }

    mockValidateMnemonic = jest.spyOn(app().auth, 'validateMnemonic').mockResolvedValue('none')
    mockSetMnemonicHash = jest.spyOn(app().auth, 'setMnemonicHash').mockResolvedValue(undefined)
    _mockGetIndexerURL = jest
      .spyOn(app().settings, 'getIndexerURL')
      .mockResolvedValue('https://indexer.example.com')
    mockSetIndexerURL = jest.spyOn(app().settings, 'setIndexerURL').mockResolvedValue(undefined)
    mockGetAppKey = jest.spyOn(app().auth, 'getAppKey')
    mockOnConnected = jest.spyOn(app().auth, 'onConnected').mockResolvedValue(undefined)

    _mockBuilderCreate = jest.spyOn(app().auth.builder, 'create').mockResolvedValue(undefined)
    mockBuilderConnectWithKey = jest.spyOn(app().auth.builder, 'connectWithKey')
    mockBuilderRequestConnection = jest.spyOn(app().auth.builder, 'requestConnection')
    mockBuilderRegister = jest.spyOn(app().auth.builder, 'register')
    mockBuilderWaitForApproval = jest.spyOn(app().auth.builder, 'waitForApproval')
    mockBuilderCancel = jest.spyOn(app().auth.builder, 'cancel')

    _mockGetLastSdk = jest.spyOn(getMobileSdkAuth(), 'getLastSdk').mockReturnValue(mockSdk)
  })

  afterEach(() => {
    jest.clearAllMocks()
    jest.restoreAllMocks()
  })

  describe('connectSdk', () => {
    it('returns SDK when AppKey exists and connectWithKey succeeds', async () => {
      mockGetAppKey.mockResolvedValue(mockKeyBytes)
      mockBuilderConnectWithKey.mockResolvedValue(true)

      const sdk = await sdkStore.connectSdk()

      expect(sdk).toBe(mockSdk)
      expect(internal().getSdk()).not.toBeNull()
    })

    it('returns null when no AppKey exists', async () => {
      mockGetAppKey.mockResolvedValue(null)

      const sdk = await sdkStore.connectSdk()

      expect(sdk).toBeNull()
      expect(mockBuilderConnectWithKey).not.toHaveBeenCalled()
    })

    it('returns null when connectWithKey returns false', async () => {
      mockGetAppKey.mockResolvedValue(mockKeyBytes)
      mockBuilderConnectWithKey.mockResolvedValue(false)

      const sdk = await sdkStore.connectSdk()

      expect(sdk).toBeNull()
      expect(internal().getSdk()).toBeNull()
    })

    it('returns null when connectWithKey throws', async () => {
      mockGetAppKey.mockResolvedValue(mockKeyBytes)
      mockBuilderConnectWithKey.mockRejectedValue(new Error('Connection failed'))

      const sdk = await sdkStore.connectSdk()

      expect(sdk).toBeNull()
      expect(internal().getSdk()).toBeNull()
    })

    it('returns null when connectWithKey times out (20s)', async () => {
      jest.useFakeTimers()

      try {
        mockGetAppKey.mockResolvedValue(mockKeyBytes)
        mockBuilderConnectWithKey.mockImplementation(() => new Promise(() => {}))

        const initPromise = sdkStore.connectSdk()
        await jest.advanceTimersByTimeAsync(20_000)
        const sdk = await initPromise

        expect(sdk).toBeNull()
      } finally {
        jest.useRealTimers()
      }
    })
  })

  describe('reconnectIndexer', () => {
    it('returns true when connectSdk succeeds', async () => {
      mockGetAppKey.mockResolvedValue(mockKeyBytes)
      mockBuilderConnectWithKey.mockResolvedValue(true)

      const result = await sdkStore.reconnectIndexer()

      expect(result).toBe(true)
      expect(app().connection.getState().isConnected).toBe(true)
      expect(app().connection.getState().connectionError).toBeNull()
      expect(app().connection.getState().isReconnecting).toBe(false)
    })

    it('returns false if connectSdk fails', async () => {
      mockGetAppKey.mockResolvedValue(mockKeyBytes)
      mockBuilderConnectWithKey.mockRejectedValue(new Error('Connection failed'))

      const result = await sdkStore.reconnectIndexer()

      expect(result).toBe(false)
      expect(app().connection.getState().isConnected).toBe(false)
      expect(app().connection.getState().connectionError).toBe('Failed to connect to indexer.')
      expect(app().connection.getState().isReconnecting).toBe(false)
    })

    it('returns false if no AppKey yet', async () => {
      mockGetAppKey.mockResolvedValue(null)

      const result = await sdkStore.reconnectIndexer()

      expect(result).toBe(false)
      expect(app().connection.getState().isConnected).toBe(false)
      expect(app().connection.getState().connectionError).toBe('Failed to connect to indexer.')
    })

    it('returns false if auth in progress', async () => {
      app().connection.setState({ isAuthing: true })

      const result = await sdkStore.reconnectIndexer()

      expect(result).toBe(false)
      expect(mockGetAppKey).not.toHaveBeenCalled()

      app().connection.setState({ isAuthing: false })
    })

    it('returns false immediately if already reconnecting', async () => {
      mockGetAppKey.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(mockKeyBytes), 50)),
      )
      mockBuilderConnectWithKey.mockResolvedValue(true)

      const first = sdkStore.reconnectIndexer()
      const second = await sdkStore.reconnectIndexer()

      expect(second).toBe(false)
      await first
    })

    it('returns false when connectWithKey times out (20s)', async () => {
      jest.useFakeTimers()

      try {
        mockGetAppKey.mockResolvedValue(mockKeyBytes)
        mockBuilderConnectWithKey.mockImplementation(() => new Promise(() => {}))

        const reconnectPromise = sdkStore.reconnectIndexer()
        await jest.advanceTimersByTimeAsync(20_000)
        const result = await reconnectPromise

        expect(result).toBe(false)
        expect(app().connection.getState().isConnected).toBe(false)
      } finally {
        jest.useRealTimers()
      }
    })
  })

  describe('authenticateIndexer', () => {
    const indexerUrl = 'https://indexer.example.com'

    beforeEach(() => {
      mockBuilderRequestConnection.mockResolvedValue('https://indexer.example.com/auth')
      const mock = createCancellableMock(0)
      mockBuilderWaitForApproval.mockImplementation(mock.waitImpl)
      mockBuilderCancel.mockImplementation(mock.cancelImpl)
      mockOpenAuthURL.mockResolvedValue(true)
    })

    describe('returning user (has AppKey)', () => {
      beforeEach(() => {
        mockGetAppKey.mockResolvedValue(mockKeyBytes)
      })

      it('connects and returns alreadyConnected: true', async () => {
        mockBuilderConnectWithKey.mockResolvedValue(true)

        const [result, error] = await sdkStore.authenticateIndexer(indexerUrl)

        expect(error).toBeNull()
        expect(result?.alreadyConnected).toBe(true)
        expect(mockBuilderConnectWithKey).toHaveBeenCalledWith(mockKeyHex)
        expect(mockBuilderRequestConnection).not.toHaveBeenCalled()
        expect(mockOpenAuthURL).not.toHaveBeenCalled()
        expect(internal().getSdk()).not.toBeNull()
        expect(app().connection.getState().isConnected).toBe(true)
        expect(mockSetIndexerURL).toHaveBeenCalledWith(indexerUrl)
        expectCleanAuthState()
      })

      it('returns error when connectWithKey throws', async () => {
        mockBuilderConnectWithKey.mockRejectedValue(new Error('Connection failed'))

        const [, error] = await sdkStore.authenticateIndexer(indexerUrl)

        expect(error?.type).toBe('error')
        if (error?.type === 'error') {
          expect(error.message).toBe('Connection failed')
        }
        expect(mockBuilderRequestConnection).not.toHaveBeenCalled()
        expectCleanAuthState()
      })

      it('returns error when connectWithKey times out', async () => {
        jest.useFakeTimers()
        try {
          mockBuilderConnectWithKey.mockImplementation(() => new Promise(() => {}))

          const promise = sdkStore.authenticateIndexer(indexerUrl)
          await jest.advanceTimersByTimeAsync(20_000)
          const [, error] = await promise

          expect(error?.type).toBe('error')
          if (error?.type === 'error') {
            expect(error.message).toBe('Connection timed out')
          }
          expectCleanAuthState()
        } finally {
          jest.useRealTimers()
        }
      })

      it('runs browser auth when AppKey exists but connectWithKey returns false', async () => {
        mockBuilderConnectWithKey.mockResolvedValue(false)

        const [result, error] = await sdkStore.authenticateIndexer(indexerUrl)

        expect(error).toBeNull()
        expect(result?.alreadyConnected).toBe(false)
        expect(mockBuilderConnectWithKey).toHaveBeenCalledWith(mockKeyHex)
        expect(mockBuilderRequestConnection).toHaveBeenCalled()
        expectCleanAuthState()
      })
    })

    describe('new user — browser auth state machine (iOS)', () => {
      beforeEach(() => {
        mockGetAppKey.mockResolvedValue(null)
      })

      it('approval poll resolves before browser closes → ok, closes browser', async () => {
        jest.useFakeTimers()
        try {
          const mock = createCancellableMock(3_000)
          mockBuilderWaitForApproval.mockImplementation(mock.waitImpl)
          mockBuilderCancel.mockImplementation(mock.cancelImpl)
          mockOpenAuthURL.mockImplementation(() => new Promise(() => {}))

          const promise = sdkStore.authenticateIndexer(indexerUrl)
          await jest.advanceTimersByTimeAsync(3_000)
          const [result, error] = await promise

          expect(error).toBeNull()
          expect(result?.alreadyConnected).toBe(false)
          expect(mockCloseAuthBrowser).toHaveBeenCalled()
          expect(sdkStore.getPendingApproval()).toEqual({
            indexerURL: indexerUrl,
          })
          expectCleanAuthState()
        } finally {
          jest.useRealTimers()
        }
      })

      it('user approves at 3s, poll confirms at 5s → ok (within 6s grace)', async () => {
        jest.useFakeTimers()
        try {
          mockOpenAuthURL.mockImplementation(
            () => new Promise((resolve) => setTimeout(() => resolve(true), 3_000)),
          )
          const mock = createCancellableMock(5_000)
          mockBuilderWaitForApproval.mockImplementation(mock.waitImpl)
          mockBuilderCancel.mockImplementation(mock.cancelImpl)

          const promise = sdkStore.authenticateIndexer(indexerUrl)
          await jest.advanceTimersByTimeAsync(5_000)
          const [result, error] = await promise

          expect(error).toBeNull()
          expect(result?.alreadyConnected).toBe(false)
          expectCleanAuthState()
        } finally {
          jest.useRealTimers()
        }
      })

      it('user approves at 3s, poll takes 20s → cancelled (6s grace expires)', async () => {
        jest.useFakeTimers()
        try {
          mockOpenAuthURL.mockImplementation(
            () => new Promise((resolve) => setTimeout(() => resolve(true), 3_000)),
          )
          const mock = createCancellableMock(20_000)
          mockBuilderWaitForApproval.mockImplementation(mock.waitImpl)
          mockBuilderCancel.mockImplementation(mock.cancelImpl)

          const promise = sdkStore.authenticateIndexer(indexerUrl)
          await jest.advanceTimersByTimeAsync(3_000 + BROWSER_CLOSE_GRACE_MS)
          const [, error] = await promise

          expect(error?.type).toBe('cancelled')
          expectCleanAuthState()
        } finally {
          jest.useRealTimers()
        }
      })

      it('user approves then closes browser manually, poll confirms at 5s → ok', async () => {
        jest.useFakeTimers()
        try {
          mockOpenAuthURL.mockImplementation(
            () => new Promise((resolve) => setTimeout(() => resolve(false), 3_000)),
          )
          const mock = createCancellableMock(5_000)
          mockBuilderWaitForApproval.mockImplementation(mock.waitImpl)
          mockBuilderCancel.mockImplementation(mock.cancelImpl)

          const promise = sdkStore.authenticateIndexer(indexerUrl)
          await jest.advanceTimersByTimeAsync(5_000)
          const [result, error] = await promise

          expect(error).toBeNull()
          expect(result?.alreadyConnected).toBe(false)
          expectCleanAuthState()
        } finally {
          jest.useRealTimers()
        }
      })

      it('user closes browser without approving, poll never resolves → cancelled after grace period', async () => {
        jest.useFakeTimers()
        try {
          mockOpenAuthURL.mockImplementation(
            () => new Promise((resolve) => setTimeout(() => resolve(false), 3_000)),
          )
          const mock = createCancellableMock()
          mockBuilderWaitForApproval.mockImplementation(mock.waitImpl)
          mockBuilderCancel.mockImplementation(mock.cancelImpl)

          const promise = sdkStore.authenticateIndexer(indexerUrl)
          await jest.advanceTimersByTimeAsync(3_000 + BROWSER_CLOSE_GRACE_MS)
          const [, error] = await promise

          expect(error?.type).toBe('cancelled')
          expectCleanAuthState()
        } finally {
          jest.useRealTimers()
        }
      })

      it('cancelAuth() during browser wait → cancelled immediately, browser closed', async () => {
        jest.useFakeTimers()
        try {
          mockOpenAuthURL.mockImplementation(() => new Promise(() => {}))
          const mock = createCancellableMock()
          mockBuilderWaitForApproval.mockImplementation(mock.waitImpl)
          mockBuilderCancel.mockImplementation(mock.cancelImpl)

          const promise = sdkStore.authenticateIndexer(indexerUrl)
          await jest.advanceTimersByTimeAsync(0)
          sdkStore.cancelAuth()
          await jest.advanceTimersByTimeAsync(0)
          const [, error] = await promise

          expect(error?.type).toBe('cancelled')
          expect(mockCloseAuthBrowser).toHaveBeenCalled()
          expectCleanAuthState()
        } finally {
          jest.useRealTimers()
        }
      })

      it('cancelAuth() during grace period (callback) → cancelled, poll aborted', async () => {
        jest.useFakeTimers()
        try {
          mockOpenAuthURL.mockImplementation(
            () => new Promise((resolve) => setTimeout(() => resolve(true), 1_000)),
          )
          const mock = createCancellableMock()
          mockBuilderWaitForApproval.mockImplementation(mock.waitImpl)
          mockBuilderCancel.mockImplementation(mock.cancelImpl)

          const promise = sdkStore.authenticateIndexer(indexerUrl)
          await jest.advanceTimersByTimeAsync(1_000)
          await jest.advanceTimersByTimeAsync(0)
          sdkStore.cancelAuth()
          await jest.advanceTimersByTimeAsync(0)
          const [, error] = await promise

          expect(error?.type).toBe('cancelled')
          expect(mockCloseAuthBrowser).toHaveBeenCalled()
          expectCleanAuthState()
        } finally {
          jest.useRealTimers()
        }
      })

      it('cancelAuth() during manual-close grace period → cancelled immediately', async () => {
        jest.useFakeTimers()
        try {
          mockOpenAuthURL.mockImplementation(
            () => new Promise((resolve) => setTimeout(() => resolve(false), 1_000)),
          )
          const mock = createCancellableMock()
          mockBuilderWaitForApproval.mockImplementation(mock.waitImpl)
          mockBuilderCancel.mockImplementation(mock.cancelImpl)

          const promise = sdkStore.authenticateIndexer(indexerUrl)
          await jest.advanceTimersByTimeAsync(1_000)
          await jest.advanceTimersByTimeAsync(2_000)
          sdkStore.cancelAuth()
          await jest.advanceTimersByTimeAsync(0)
          const [, error] = await promise

          expect(error?.type).toBe('cancelled')
          expect(mockCloseAuthBrowser).toHaveBeenCalled()
          expectCleanAuthState()
        } finally {
          jest.useRealTimers()
        }
      })

      it('SDK poll error wins race → browser closes with error (iOS-only, poll starts immediately)', async () => {
        jest.useFakeTimers()
        try {
          mockOpenAuthURL.mockImplementation(() => new Promise(() => {}))
          mockBuilderWaitForApproval.mockRejectedValue(new Error('network failure'))

          const promise = sdkStore.authenticateIndexer(indexerUrl)
          await jest.advanceTimersByTimeAsync(0)
          const [, error] = await promise

          expect(error?.type).toBe('error')
          if (error?.type === 'error') {
            expect(error.message).toBe('network failure')
          }
          expect(mockCloseAuthBrowser).toHaveBeenCalled()
          expectCleanAuthState()
        } finally {
          jest.useRealTimers()
        }
      })

      it('requestConnection fails → error returned, no browser opened', async () => {
        mockBuilderRequestConnection.mockRejectedValue(new Error('Request failed'))

        const [, error] = await sdkStore.authenticateIndexer(indexerUrl)

        expect(error?.type).toBe('error')
        if (error?.type === 'error') {
          expect(error.message).toBe('Request failed')
        }
        expect(mockOpenAuthURL).not.toHaveBeenCalled()
        expectCleanAuthState()
      })
    })

    describe('new user — browser auth state machine (Android)', () => {
      beforeEach(() => {
        mockGetAppKey.mockResolvedValue(null)
        mockPlatform.OS = 'android'
      })

      it('SDK poll is deferred — not called while browser is open', async () => {
        jest.useFakeTimers()
        try {
          const mock = createCancellableMock()
          mockBuilderWaitForApproval.mockImplementation(mock.waitImpl)
          mockBuilderCancel.mockImplementation(mock.cancelImpl)
          mockOpenAuthURL.mockImplementation(() => new Promise(() => {}))

          sdkStore.authenticateIndexer(indexerUrl)
          await jest.advanceTimersByTimeAsync(20_000)

          expect(mock.callCount()).toBe(0)
          expect(mockBuilderWaitForApproval).not.toHaveBeenCalled()

          sdkStore.cancelAuth()
          await jest.advanceTimersByTimeAsync(0)
        } finally {
          jest.useRealTimers()
        }
      })

      it('user approves (callback) → deferred poll starts and confirms within grace', async () => {
        jest.useFakeTimers()
        try {
          const mock = createCancellableMock(2_000)
          mockBuilderWaitForApproval.mockImplementation(mock.waitImpl)
          mockBuilderCancel.mockImplementation(mock.cancelImpl)
          mockOpenAuthURL.mockImplementation(
            () => new Promise((resolve) => setTimeout(() => resolve(true), 5_000)),
          )

          const promise = sdkStore.authenticateIndexer(indexerUrl)

          await jest.advanceTimersByTimeAsync(4_999)
          expect(mock.callCount()).toBe(0)

          await jest.advanceTimersByTimeAsync(1)
          expect(mock.callCount()).toBe(1)

          await jest.advanceTimersByTimeAsync(2_000)
          const [result, error] = await promise

          expect(error).toBeNull()
          expect(result?.alreadyConnected).toBe(false)
          expect(mockAppStateSubscription.remove).toHaveBeenCalled()
          expectCleanAuthState()
        } finally {
          jest.useRealTimers()
        }
      })

      it('user approves and closes browser manually → deferred poll confirms within grace', async () => {
        jest.useFakeTimers()
        try {
          const mock = createCancellableMock(5_000)
          mockBuilderWaitForApproval.mockImplementation(mock.waitImpl)
          mockBuilderCancel.mockImplementation(mock.cancelImpl)
          mockOpenAuthURL.mockImplementation(
            () => new Promise((resolve) => setTimeout(() => resolve(false), 3_000)),
          )

          const promise = sdkStore.authenticateIndexer(indexerUrl)

          await jest.advanceTimersByTimeAsync(2_999)
          expect(mock.callCount()).toBe(0)

          await jest.advanceTimersByTimeAsync(1)
          expect(mock.callCount()).toBe(1)

          await jest.advanceTimersByTimeAsync(5_000)
          const [result, error] = await promise

          expect(error).toBeNull()
          expect(result?.alreadyConnected).toBe(false)
          expect(mockAppStateSubscription.remove).toHaveBeenCalled()
          expectCleanAuthState()
        } finally {
          jest.useRealTimers()
        }
      })

      it('user closes browser without approving → deferred poll starts, grace expires → cancelled', async () => {
        jest.useFakeTimers()
        try {
          const mock = createCancellableMock()
          mockBuilderWaitForApproval.mockImplementation(mock.waitImpl)
          mockBuilderCancel.mockImplementation(mock.cancelImpl)
          mockOpenAuthURL.mockImplementation(
            () => new Promise((resolve) => setTimeout(() => resolve(false), 3_000)),
          )

          const promise = sdkStore.authenticateIndexer(indexerUrl)
          await jest.advanceTimersByTimeAsync(3_000)
          await jest.advanceTimersByTimeAsync(0)
          expect(mock.callCount()).toBe(1)

          await jest.advanceTimersByTimeAsync(BROWSER_CLOSE_GRACE_MS)
          const [, error] = await promise

          expect(error?.type).toBe('cancelled')
          expect(mockAppStateSubscription.remove).toHaveBeenCalled()
          expectCleanAuthState()
        } finally {
          jest.useRealTimers()
        }
      })

      it('AppState foreground → deferred poll starts and confirms', async () => {
        jest.useFakeTimers()
        try {
          const mock = createCancellableMock(2_000)
          mockBuilderWaitForApproval.mockImplementation(mock.waitImpl)
          mockBuilderCancel.mockImplementation(mock.cancelImpl)
          mockOpenAuthURL.mockImplementation(() => new Promise(() => {}))

          const promise = sdkStore.authenticateIndexer(indexerUrl)
          await jest.advanceTimersByTimeAsync(0)

          expect(mockAppStateListeners.length).toBeGreaterThan(0)
          expect(mock.callCount()).toBe(0)

          mockAppStateListeners[0]('background')
          mockAppStateListeners[0]('active')
          await jest.advanceTimersByTimeAsync(0)

          expect(mock.callCount()).toBe(1)

          await jest.advanceTimersByTimeAsync(2_000)
          const [result, error] = await promise

          expect(error).toBeNull()
          expect(result?.alreadyConnected).toBe(false)
          expect(mockAppStateSubscription.remove).toHaveBeenCalled()
          expectCleanAuthState()
        } finally {
          jest.useRealTimers()
        }
      })

      it('AppState foreground, poll never resolves → cancelled after grace period', async () => {
        jest.useFakeTimers()
        try {
          mockOpenAuthURL.mockImplementation(() => new Promise(() => {}))
          const mock = createCancellableMock()
          mockBuilderWaitForApproval.mockImplementation(mock.waitImpl)
          mockBuilderCancel.mockImplementation(mock.cancelImpl)

          const promise = sdkStore.authenticateIndexer(indexerUrl)
          await jest.advanceTimersByTimeAsync(0)

          mockAppStateListeners[0]('background')
          mockAppStateListeners[0]('active')

          await jest.advanceTimersByTimeAsync(BROWSER_CLOSE_GRACE_MS)
          const [, error] = await promise

          expect(error?.type).toBe('cancelled')
          expect(mockAppStateSubscription.remove).toHaveBeenCalled()
          expectCleanAuthState()
        } finally {
          jest.useRealTimers()
        }
      })

      it('AppState foreground, then cancelAuth() during grace → cancelled immediately', async () => {
        jest.useFakeTimers()
        try {
          mockOpenAuthURL.mockImplementation(() => new Promise(() => {}))
          const mock = createCancellableMock()
          mockBuilderWaitForApproval.mockImplementation(mock.waitImpl)
          mockBuilderCancel.mockImplementation(mock.cancelImpl)

          const promise = sdkStore.authenticateIndexer(indexerUrl)
          await jest.advanceTimersByTimeAsync(0)

          mockAppStateListeners[0]('background')
          mockAppStateListeners[0]('active')
          await jest.advanceTimersByTimeAsync(0)

          sdkStore.cancelAuth()
          await jest.advanceTimersByTimeAsync(0)
          const [, error] = await promise

          expect(error?.type).toBe('cancelled')
          expect(mockCloseAuthBrowser).toHaveBeenCalled()
          expect(mockAppStateSubscription.remove).toHaveBeenCalled()
          expectCleanAuthState()
        } finally {
          jest.useRealTimers()
        }
      })
    })
  })

  describe('registerWithIndexer', () => {
    const mnemonic =
      'friend result negative scale estate denial orange pill donate knee blossom stereo'
    const testIndexerURL = 'https://indexer.example.com'

    beforeEach(() => {
      mockBuilderRequestConnection.mockResolvedValue('https://indexer.example.com/auth')
      const mock = createCancellableMock(0)
      mockBuilderWaitForApproval.mockImplementation(mock.waitImpl)
      mockBuilderCancel.mockImplementation(mock.cancelImpl)
      mockOpenAuthURL.mockResolvedValue(true)
      mockBuilderRegister.mockResolvedValue(mockAppKeyHex)
    })

    describe('with pending approval from authenticateIndexer', () => {
      beforeEach(() => {
        sdkStore.setPendingApproval({
          indexerURL: testIndexerURL,
        })
      })

      it('uses pending approval, skips browser auth, registers', async () => {
        const [, error] = await sdkStore.registerWithIndexer(mnemonic, testIndexerURL)

        expect(error).toBeNull()
        expect(mockBuilderRequestConnection).not.toHaveBeenCalled()
        expect(mockOpenAuthURL).not.toHaveBeenCalled()
        expect(mockBuilderRegister).toHaveBeenCalledWith(mnemonic)
        expect(mockSetMnemonicHash).toHaveBeenCalledWith(mnemonic)
        expect(mockOnConnected).toHaveBeenCalledWith(mockAppKeyHex, testIndexerURL)
        expect(mockSetIndexerURL).toHaveBeenCalledWith(testIndexerURL)
        expect(app().connection.getState().isConnected).toBe(true)
        expect(sdkStore.getPendingApproval()).toBeNull()
        expectCleanAuthState()
      })

      it('keeps pending approval on mnemonic mismatch so user can retry', async () => {
        mockValidateMnemonic.mockResolvedValue('invalid')

        const [, error] = await sdkStore.registerWithIndexer(mnemonic, testIndexerURL)

        expect(error?.type).toBe('mnemonicMismatch')
        expect(mockBuilderRegister).not.toHaveBeenCalled()
        expect(sdkStore.getPendingApproval()).not.toBeNull()
        expectCleanAuthState()
      })
    })

    describe('without pending approval (fallback browser auth)', () => {
      it('runs browser auth when no pending approval', async () => {
        const [, error] = await sdkStore.registerWithIndexer(mnemonic, testIndexerURL)

        expect(error).toBeNull()
        expect(mockBuilderRequestConnection).toHaveBeenCalled()
        expect(mockOpenAuthURL).toHaveBeenCalled()
        expect(mockBuilderWaitForApproval).toHaveBeenCalled()
        expect(mockBuilderRegister).toHaveBeenCalledWith(mnemonic)
        expectCleanAuthState()
      })

      it('runs browser auth when pending approval is for different indexer', async () => {
        sdkStore.setPendingApproval({
          indexerURL: 'https://different-indexer.com',
        })

        const [, error] = await sdkStore.registerWithIndexer(mnemonic, testIndexerURL)

        expect(error).toBeNull()
        expect(mockBuilderRequestConnection).toHaveBeenCalled()
        expect(mockBuilderRegister).toHaveBeenCalledWith(mnemonic)
        expectCleanAuthState()
      })

      it('user closes browser without approving, grace expires → cancelled', async () => {
        jest.useFakeTimers()
        try {
          mockOpenAuthURL.mockResolvedValue(false)
          const mock = createCancellableMock()
          mockBuilderWaitForApproval.mockImplementation(mock.waitImpl)
          mockBuilderCancel.mockImplementation(mock.cancelImpl)

          const promise = sdkStore.registerWithIndexer(mnemonic, testIndexerURL)
          await jest.advanceTimersByTimeAsync(BROWSER_CLOSE_GRACE_MS)
          const [, error] = await promise

          expect(error?.type).toBe('cancelled')
          expect(mockBuilderRegister).not.toHaveBeenCalled()
          expectCleanAuthState()
        } finally {
          jest.useRealTimers()
        }
      })

      it('user approves (callback), poll succeeds within grace → registers successfully', async () => {
        jest.useFakeTimers()
        try {
          mockOpenAuthURL.mockImplementation(
            () => new Promise((resolve) => setTimeout(() => resolve(true), 1_000)),
          )
          const mock = createCancellableMock(3_000)
          mockBuilderWaitForApproval.mockImplementation(mock.waitImpl)
          mockBuilderCancel.mockImplementation(mock.cancelImpl)

          const promise = sdkStore.registerWithIndexer(mnemonic, testIndexerURL)
          await jest.advanceTimersByTimeAsync(3_000)
          const [, error] = await promise

          expect(error).toBeNull()
          expect(mockBuilderRegister).toHaveBeenCalledWith(mnemonic)
          expectCleanAuthState()
        } finally {
          jest.useRealTimers()
        }
      })

      it('cancelAuth() cancels register flow', async () => {
        jest.useFakeTimers()
        try {
          mockOpenAuthURL.mockImplementation(() => new Promise(() => {}))
          const mock = createCancellableMock()
          mockBuilderWaitForApproval.mockImplementation(mock.waitImpl)
          mockBuilderCancel.mockImplementation(mock.cancelImpl)

          const promise = sdkStore.registerWithIndexer(mnemonic, testIndexerURL)
          await jest.advanceTimersByTimeAsync(0)
          sdkStore.cancelAuth()
          await jest.advanceTimersByTimeAsync(0)
          const [, error] = await promise

          expect(error?.type).toBe('cancelled')
          expect(mockBuilderRegister).not.toHaveBeenCalled()
          expect(mockCloseAuthBrowser).toHaveBeenCalled()
          expectCleanAuthState()
        } finally {
          jest.useRealTimers()
        }
      })
    })

    it('returns error when builder.register() fails', async () => {
      sdkStore.setPendingApproval({ indexerURL: testIndexerURL })
      mockBuilderRegister.mockRejectedValue(new Error('Registration failed'))

      const [, error] = await sdkStore.registerWithIndexer(mnemonic, testIndexerURL)

      expect(error?.type).toBe('error')
      if (error?.type === 'error') {
        expect(error.message).toBe('Registration failed')
      }
      expect(mockOnConnected).not.toHaveBeenCalled()
      expectCleanAuthState()
    })

    it('returns error when builder.requestConnection() times out', async () => {
      jest.useFakeTimers()

      try {
        mockBuilderRequestConnection.mockImplementation(() => new Promise(() => {}))

        const registerPromise = sdkStore.registerWithIndexer(mnemonic, testIndexerURL)
        await jest.advanceTimersByTimeAsync(20_000)
        const [, error] = await registerPromise

        expect(error?.type).toBe('error')
        if (error?.type === 'error') {
          expect(error.message).toBe('Connection timed out')
        }
        expect(mockBuilderRegister).not.toHaveBeenCalled()
        expectCleanAuthState()
      } finally {
        jest.useRealTimers()
      }
    })

    it('returns error when builder.register() times out', async () => {
      jest.useFakeTimers()

      try {
        sdkStore.setPendingApproval({ indexerURL: testIndexerURL })
        mockBuilderRegister.mockImplementation(() => new Promise(() => {}))

        const registerPromise = sdkStore.registerWithIndexer(mnemonic, testIndexerURL)
        await jest.advanceTimersByTimeAsync(60_000)
        const [, error] = await registerPromise

        expect(error?.type).toBe('error')
        if (error?.type === 'error') {
          expect(error.message).toBe('Connection timed out')
        }
        expect(mockOnConnected).not.toHaveBeenCalled()
        expectCleanAuthState()
      } finally {
        jest.useRealTimers()
      }
    })
  })
})
