import type { AppKey, BuilderInterface, SdkInterface } from 'react-native-sia'
import { closeAuthBrowser, openAuthURL } from '../lib/openAuthUrl'
import { getAppKey, getAppKeyForIndexer, setAppKeyForIndexer } from './appKey'
import { setMnemonicHash, validateMnemonic } from './mnemonic'
import * as sdkStore from './sdk'
import { getIndexerURL, setIndexerURL } from './settings'

// Builder method mocks
let mockConnected: jest.Mock<Promise<SdkInterface | null>>
let mockRequestConnection: jest.Mock<Promise<BuilderInterface>>

// BuilderInterface method mocks (returned by requestConnection)
let mockResponseUrl: jest.Mock<string>
let mockWaitForApproval: jest.Mock<Promise<BuilderInterface>>
let mockInterfaceRegister: jest.Mock<Promise<SdkInterface>>

// AppState mock
let mockAppStateListeners: Array<(state: string) => void> = []
const mockAppStateSubscription = { remove: jest.fn() }
const mockPlatform = { OS: 'ios' as string }

jest.mock('react-native', () => ({
  get Platform() {
    return mockPlatform
  },
  AppState: {
    addEventListener: jest.fn(
      (_event: string, handler: (state: string) => void) => {
        mockAppStateListeners.push(handler)
        return mockAppStateSubscription
      },
    ),
  },
}))

jest.mock('react-native-sia', () => {
  mockConnected = jest.fn()
  mockRequestConnection = jest.fn()

  return {
    Builder: jest.fn(() => ({
      connected: mockConnected,
      requestConnection: mockRequestConnection,
    })),
  }
})

jest.mock('./appKey', () => ({
  getAppKey: jest.fn(),
  getAppKeyForIndexer: jest.fn(),
  setAppKeyForIndexer: jest.fn(),
}))
jest.mock('./mnemonic', () => ({
  setMnemonicHash: jest.fn(),
  validateMnemonic: jest.fn(),
}))
jest.mock('./settings', () => ({
  getIndexerURL: jest.fn(),
  setIndexerURL: jest.fn(),
}))

// Helper to verify clean state after operations.
function expectCleanAuthState() {
  expect(sdkStore.useSdkStore.getState().isAuthing).toBe(false)
}
jest.mock('../lib/openAuthUrl', () => ({
  openAuthURL: jest.fn(),
  closeAuthBrowser: jest.fn(),
}))
jest.mock('@siastorage/logger', () => ({ logger: { log: jest.fn() } }))
jest.mock('@siastorage/core/config', () => ({ APP_KEY: '0'.repeat(64) }))

const mockGetAppKey = jest.mocked(getAppKey)
const mockGetAppKeyForIndexer = jest.mocked(getAppKeyForIndexer)
const mockSetAppKeyForIndexer = jest.mocked(setAppKeyForIndexer)
const mockSetMnemonicHash = jest.mocked(setMnemonicHash)
const mockValidateMnemonic = jest.mocked(validateMnemonic)
const mockGetIndexerURL = jest.mocked(getIndexerURL)
const mockSetIndexerURL = jest.mocked(setIndexerURL)
const mockOpenAuthURL = jest.mocked(openAuthURL)
const mockCloseAuthBrowser = jest.mocked(closeAuthBrowser)

const BROWSER_CLOSE_GRACE_MS = 6_000

/**
 * Creates a realistic mock for builder.waitForApproval() that respects
 * the AbortSignal parameter, just like the real SDK does.
 *
 * - If resolveAfterMs is provided, resolves with the given value after that delay.
 * - If the signal is aborted before resolution, rejects with an AbortError.
 * - If neither, the promise never resolves (simulates indefinite polling).
 *
 * Returns an object with:
 * - impl: the mock implementation function
 * - callCount: returns how many times the mock was invoked
 */
function createAbortAwareMock(
  resolveValue: BuilderInterface,
  resolveAfterMs?: number,
) {
  let calls = 0
  const impl = (opts?: { signal: AbortSignal }) => {
    calls++
    return new Promise<BuilderInterface>((resolve, reject) => {
      const signal = opts?.signal

      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }

      let timer: ReturnType<typeof setTimeout> | undefined
      const onAbort = () => {
        if (timer) clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      }

      signal?.addEventListener('abort', onAbort, { once: true })

      if (resolveAfterMs !== undefined) {
        timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort)
          resolve(resolveValue)
        }, resolveAfterMs)
      }
    })
  }
  return { impl, callCount: () => calls }
}

describe('sdk store', () => {
  let mockAppKey: AppKey
  let mockSdk: SdkInterface
  let mockBuilderInterface: BuilderInterface

  beforeEach(() => {
    jest.clearAllMocks()
    sdkStore.resetSdk()

    mockPlatform.OS = 'ios'
    mockAppStateListeners = []
    mockAppStateSubscription.remove.mockClear()

    mockResponseUrl = jest.fn()
    mockWaitForApproval = jest.fn()
    mockInterfaceRegister = jest.fn()

    mockAppKey = {
      export_: jest.fn(() => new ArrayBuffer(32)),
    } as unknown as AppKey

    mockSdk = {
      object: jest.fn(),
      saveObject: jest.fn(),
      appKey: jest.fn(() => mockAppKey),
      objectEvents: jest.fn().mockResolvedValue([]),
    } as unknown as SdkInterface

    // Default: mnemonic validation returns null (no hash to validate against)
    mockValidateMnemonic.mockResolvedValue('none')

    mockBuilderInterface = {
      responseUrl: mockResponseUrl,
      waitForApproval: mockWaitForApproval,
      register: mockInterfaceRegister,
    } as unknown as BuilderInterface

    // Default: indexer URL available
    mockGetIndexerURL.mockResolvedValue('https://indexer.example.com')
  })

  afterEach(() => {
    jest.clearAllMocks()
    jest.restoreAllMocks()
  })

  describe('connectSdk', () => {
    it('returns SDK when AppKey exists and builder.connected() succeeds', async () => {
      mockGetAppKey.mockResolvedValue(mockAppKey)
      mockConnected.mockResolvedValue(mockSdk)

      const sdk = await sdkStore.connectSdk()

      expect(sdk).toBe(mockSdk)
      expect(sdkStore.getSdk()).toBe(mockSdk)
    })

    it('returns null when no AppKey exists', async () => {
      mockGetAppKey.mockRejectedValue(new Error('No AppKey'))

      const sdk = await sdkStore.connectSdk()

      expect(sdk).toBeNull()
      expect(mockConnected).not.toHaveBeenCalled()
    })

    it('returns null when builder.connected() returns null', async () => {
      mockGetAppKey.mockResolvedValue(mockAppKey)
      mockConnected.mockResolvedValue(null)

      const sdk = await sdkStore.connectSdk()

      expect(sdk).toBeNull()
      expect(sdkStore.getSdk()).toBeNull()
    })

    it('returns null when builder.connected() throws', async () => {
      mockGetAppKey.mockResolvedValue(mockAppKey)
      mockConnected.mockRejectedValue(new Error('Connection failed'))

      const sdk = await sdkStore.connectSdk()

      expect(sdk).toBeNull()
      expect(sdkStore.getSdk()).toBeNull()
    })

    it('returns null when builder.connected() times out (10s)', async () => {
      jest.useFakeTimers()

      try {
        mockGetAppKey.mockResolvedValue(mockAppKey)
        mockConnected.mockImplementation(() => new Promise(() => {})) // Never resolves

        const initPromise = sdkStore.connectSdk()
        // Fast-forward past the timeout
        await jest.advanceTimersByTimeAsync(10_000)
        const sdk = await initPromise

        expect(sdk).toBeNull()
      } finally {
        jest.useRealTimers()
      }
    })
  })

  describe('reconnectIndexer', () => {
    it('returns true when connectSdk succeeds', async () => {
      mockGetAppKey.mockResolvedValue(mockAppKey)
      mockConnected.mockResolvedValue(mockSdk)

      const result = await sdkStore.reconnectIndexer()

      expect(result).toBe(true)
      expect(sdkStore.getIsConnected()).toBe(true)
      expect(sdkStore.useSdkStore.getState().connectionError).toBeNull()
      expect(sdkStore.useSdkStore.getState().isReconnecting).toBe(false)
    })

    it('returns false if connectSdk fails', async () => {
      mockGetAppKey.mockResolvedValue(mockAppKey)
      mockConnected.mockRejectedValue(new Error('Connection failed'))

      const result = await sdkStore.reconnectIndexer()

      expect(result).toBe(false)
      expect(sdkStore.getIsConnected()).toBe(false)
      expect(sdkStore.useSdkStore.getState().connectionError).toBe(
        'Failed to connect to indexer.',
      )
      expect(sdkStore.useSdkStore.getState().isReconnecting).toBe(false)
    })

    it('returns false if no AppKey yet', async () => {
      mockGetAppKey.mockRejectedValue(new Error('No AppKey'))

      const result = await sdkStore.reconnectIndexer()

      expect(result).toBe(false)
      expect(sdkStore.getIsConnected()).toBe(false)
      expect(sdkStore.useSdkStore.getState().connectionError).toBe(
        'Failed to connect to indexer.',
      )
    })

    it('returns false if auth in progress', async () => {
      // Simulate auth in progress.
      sdkStore.useSdkStore.setState({ isAuthing: true })

      const result = await sdkStore.reconnectIndexer()

      expect(result).toBe(false)
      expect(mockGetAppKey).not.toHaveBeenCalled()

      // Clean up manually since reconnect() returns early without resetting isAuthing.
      sdkStore.useSdkStore.setState({ isAuthing: false })
    })

    it('returns false immediately if already reconnecting', async () => {
      mockGetAppKey.mockImplementation(
        () =>
          new Promise((resolve) => setTimeout(() => resolve(mockAppKey), 50)),
      )
      mockConnected.mockResolvedValue(mockSdk)

      const first = sdkStore.reconnectIndexer()
      const second = await sdkStore.reconnectIndexer()

      expect(second).toBe(false)
      await first
    })

    it('returns false when builder.connected() times out (10s)', async () => {
      jest.useFakeTimers()

      try {
        mockGetAppKey.mockResolvedValue(mockAppKey)
        mockConnected.mockImplementation(() => new Promise(() => {})) // Never resolves

        const reconnectPromise = sdkStore.reconnectIndexer()
        await jest.advanceTimersByTimeAsync(10_000)
        const result = await reconnectPromise

        expect(result).toBe(false)
        expect(sdkStore.getIsConnected()).toBe(false)
      } finally {
        jest.useRealTimers()
      }
    })
  })

  describe('authenticateIndexer', () => {
    const indexerUrl = 'https://indexer.example.com'

    beforeEach(() => {
      mockRequestConnection.mockResolvedValue(mockBuilderInterface)
      mockResponseUrl.mockReturnValue('https://indexer.example.com/auth')
      // Default: abort-aware mock that resolves instantly.
      mockWaitForApproval.mockImplementation(
        createAbortAwareMock(mockBuilderInterface, 0).impl,
      )
      mockOpenAuthURL.mockResolvedValue(true)
    })

    describe('returning user (has AppKey)', () => {
      beforeEach(() => {
        mockGetAppKeyForIndexer.mockResolvedValue(mockAppKey)
      })

      it('connects and returns alreadyConnected: true', async () => {
        mockConnected.mockResolvedValue(mockSdk)

        const [result, error] = await sdkStore.authenticateIndexer(indexerUrl)

        expect(error).toBeNull()
        expect(result?.alreadyConnected).toBe(true)
        expect(mockConnected).toHaveBeenCalledWith(mockAppKey)
        expect(mockRequestConnection).not.toHaveBeenCalled()
        expect(mockOpenAuthURL).not.toHaveBeenCalled()
        expect(sdkStore.getSdk()).toBe(mockSdk)
        expect(sdkStore.getIsConnected()).toBe(true)
        expect(mockSetIndexerURL).toHaveBeenCalledWith(indexerUrl)
        expectCleanAuthState()
      })

      it('returns error when builder.connected() throws', async () => {
        mockConnected.mockRejectedValue(new Error('Connection failed'))

        const [, error] = await sdkStore.authenticateIndexer(indexerUrl)

        expect(error?.type).toBe('error')
        if (error?.type === 'error') {
          expect(error.message).toBe('Connection failed')
        }
        expect(mockRequestConnection).not.toHaveBeenCalled()
        expectCleanAuthState()
      })

      it('returns error when builder.connected() times out', async () => {
        jest.useFakeTimers()
        try {
          mockConnected.mockImplementation(() => new Promise(() => {}))

          const promise = sdkStore.authenticateIndexer(indexerUrl)
          await jest.advanceTimersByTimeAsync(10_000)
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

      it('runs browser auth when AppKey exists but builder.connected() returns null', async () => {
        // AppKey exists but is no longer valid with indexer.
        mockConnected.mockResolvedValue(null)

        const [result, error] = await sdkStore.authenticateIndexer(indexerUrl)

        expect(error).toBeNull()
        expect(result?.alreadyConnected).toBe(false)
        expect(mockConnected).toHaveBeenCalledWith(mockAppKey)
        // Should fall through to browser auth.
        expect(mockRequestConnection).toHaveBeenCalled()
        expectCleanAuthState()
      })
    })

    describe('new user — browser auth state machine (iOS)', () => {
      beforeEach(() => {
        mockGetAppKeyForIndexer.mockResolvedValue(undefined)
      })

      it('approval poll resolves before browser closes → ok, closes browser', async () => {
        jest.useFakeTimers()
        try {
          // SDK poll detects approval at 3s. Browser still open.
          mockWaitForApproval.mockImplementation(
            createAbortAwareMock(mockBuilderInterface, 3_000).impl,
          )
          mockOpenAuthURL.mockImplementation(() => new Promise(() => {}))

          const promise = sdkStore.authenticateIndexer(indexerUrl)
          await jest.advanceTimersByTimeAsync(3_000)
          const [result, error] = await promise

          expect(error).toBeNull()
          expect(result?.alreadyConnected).toBe(false)
          expect(mockCloseAuthBrowser).toHaveBeenCalled()
          // Pending approval saved for registerWithIndexer.
          // SDK not set yet - waiting for registerWithIndexer.
          expect(sdkStore.useSdkStore.getState().pendingApproval).toEqual({
            indexerURL: indexerUrl,
            builder: mockBuilderInterface,
          })
          expectCleanAuthState()
        } finally {
          jest.useRealTimers()
        }
      })

      it('user approves at 3s, poll confirms at 5s → ok (within 6s grace)', async () => {
        jest.useFakeTimers()
        try {
          // User approves at 3s (callback closes browser), poll confirms at 5s.
          mockOpenAuthURL.mockImplementation(
            () =>
              new Promise((resolve) => setTimeout(() => resolve(true), 3_000)),
          )
          mockWaitForApproval.mockImplementation(
            createAbortAwareMock(mockBuilderInterface, 5_000).impl,
          )

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
          // User approves at 3s (callback closes browser), poll too slow.
          mockOpenAuthURL.mockImplementation(
            () =>
              new Promise((resolve) => setTimeout(() => resolve(true), 3_000)),
          )
          mockWaitForApproval.mockImplementation(
            createAbortAwareMock(mockBuilderInterface, 20_000).impl,
          )

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
          // User approves on web, closes browser manually at 3s.
          // Poll detects approval at 5s, within grace period.
          mockOpenAuthURL.mockImplementation(
            () =>
              new Promise((resolve) => setTimeout(() => resolve(false), 3_000)),
          )
          mockWaitForApproval.mockImplementation(
            createAbortAwareMock(mockBuilderInterface, 5_000).impl,
          )

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
          // User closes browser at 3s without approving. Poll runs but
          // never finds approval. Grace period expires at 3s + 6s = 9s.
          // AbortSignal fires, SDK poll is cancelled.
          mockOpenAuthURL.mockImplementation(
            () =>
              new Promise((resolve) => setTimeout(() => resolve(false), 3_000)),
          )
          mockWaitForApproval.mockImplementation(
            createAbortAwareMock(mockBuilderInterface).impl,
          )

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
          // Browser and poll both pending. User navigates away.
          mockOpenAuthURL.mockImplementation(() => new Promise(() => {}))
          mockWaitForApproval.mockImplementation(
            createAbortAwareMock(mockBuilderInterface).impl,
          )

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
          // User approves at 1s (callback closes browser), navigates away during grace.
          mockOpenAuthURL.mockImplementation(
            () =>
              new Promise((resolve) => setTimeout(() => resolve(true), 1_000)),
          )
          mockWaitForApproval.mockImplementation(
            createAbortAwareMock(mockBuilderInterface).impl,
          )

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
          // Browser closes at 1s (manual), grace starts. User navigates away at 3s.
          mockOpenAuthURL.mockImplementation(
            () =>
              new Promise((resolve) => setTimeout(() => resolve(false), 1_000)),
          )
          mockWaitForApproval.mockImplementation(
            createAbortAwareMock(mockBuilderInterface).impl,
          )

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
          mockWaitForApproval.mockImplementation(() =>
            Promise.reject(new Error('network failure')),
          )

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
        mockRequestConnection.mockRejectedValue(new Error('Request failed'))

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
        mockGetAppKeyForIndexer.mockResolvedValue(undefined)
        mockPlatform.OS = 'android'
      })

      it('SDK poll is deferred — not called while browser is open', async () => {
        jest.useFakeTimers()
        try {
          const mock = createAbortAwareMock(mockBuilderInterface)
          mockWaitForApproval.mockImplementation(mock.impl)
          mockOpenAuthURL.mockImplementation(() => new Promise(() => {}))

          sdkStore.authenticateIndexer(indexerUrl)
          await jest.advanceTimersByTimeAsync(10_000)

          expect(mock.callCount()).toBe(0)
          expect(mockWaitForApproval).not.toHaveBeenCalled()

          sdkStore.cancelAuth()
          await jest.advanceTimersByTimeAsync(0)
        } finally {
          jest.useRealTimers()
        }
      })

      it('user approves (callback) → deferred poll starts and confirms within grace', async () => {
        jest.useFakeTimers()
        try {
          const mock = createAbortAwareMock(mockBuilderInterface, 2_000)
          mockWaitForApproval.mockImplementation(mock.impl)
          mockOpenAuthURL.mockImplementation(
            () =>
              new Promise((resolve) => setTimeout(() => resolve(true), 5_000)),
          )

          const promise = sdkStore.authenticateIndexer(indexerUrl)

          // Before deep link fires, poll should not have started.
          await jest.advanceTimersByTimeAsync(4_999)
          expect(mock.callCount()).toBe(0)

          // Deep link fires at 5s → poll starts.
          await jest.advanceTimersByTimeAsync(1)
          expect(mock.callCount()).toBe(1)

          // Poll confirms after 2s.
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
          const mock = createAbortAwareMock(mockBuilderInterface, 5_000)
          mockWaitForApproval.mockImplementation(mock.impl)
          mockOpenAuthURL.mockImplementation(
            () =>
              new Promise((resolve) => setTimeout(() => resolve(false), 3_000)),
          )

          const promise = sdkStore.authenticateIndexer(indexerUrl)

          // Before browser closes, poll should not have started.
          await jest.advanceTimersByTimeAsync(2_999)
          expect(mock.callCount()).toBe(0)

          // Browser closes at 3s → poll starts.
          await jest.advanceTimersByTimeAsync(1)
          expect(mock.callCount()).toBe(1)

          // Poll confirms after 5s from invocation.
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
          const mock = createAbortAwareMock(mockBuilderInterface)
          mockWaitForApproval.mockImplementation(mock.impl)
          mockOpenAuthURL.mockImplementation(
            () =>
              new Promise((resolve) => setTimeout(() => resolve(false), 3_000)),
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
          const mock = createAbortAwareMock(mockBuilderInterface, 2_000)
          mockWaitForApproval.mockImplementation(mock.impl)
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
          mockWaitForApproval.mockImplementation(
            createAbortAwareMock(mockBuilderInterface).impl,
          )

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
          mockWaitForApproval.mockImplementation(
            createAbortAwareMock(mockBuilderInterface).impl,
          )

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
      mockRequestConnection.mockResolvedValue(mockBuilderInterface)
      mockResponseUrl.mockReturnValue('https://indexer.example.com/auth')
      mockWaitForApproval.mockImplementation(
        createAbortAwareMock(mockBuilderInterface, 0).impl,
      )
      mockOpenAuthURL.mockResolvedValue(true)
      mockInterfaceRegister.mockResolvedValue(mockSdk)
    })

    describe('with pending approval from authenticateIndexer', () => {
      beforeEach(() => {
        sdkStore.useSdkStore.setState({
          pendingApproval: {
            indexerURL: testIndexerURL,
            builder: mockBuilderInterface,
          },
        })
      })

      it('uses pending approval, skips browser auth, registers', async () => {
        const [, error] = await sdkStore.registerWithIndexer(
          mnemonic,
          testIndexerURL,
        )

        expect(error).toBeNull()
        // No browser auth - uses pending approval.
        expect(mockRequestConnection).not.toHaveBeenCalled()
        expect(mockOpenAuthURL).not.toHaveBeenCalled()
        // Registration with mnemonic.
        expect(mockInterfaceRegister).toHaveBeenCalledWith(mnemonic)
        // Credentials saved.
        expect(mockSetAppKeyForIndexer).toHaveBeenCalledWith(
          testIndexerURL,
          expect.anything(),
        )
        expect(mockSetMnemonicHash).toHaveBeenCalledWith(mnemonic)
        expect(mockSetIndexerURL).toHaveBeenCalledWith(testIndexerURL)
        // SDK connected, pending approval cleared.
        expect(sdkStore.getSdk()).toBe(mockSdk)
        expect(sdkStore.getIsConnected()).toBe(true)
        expect(sdkStore.useSdkStore.getState().pendingApproval).toBeNull()
        expectCleanAuthState()
      })

      it('keeps pending approval on mnemonic mismatch so user can retry', async () => {
        mockValidateMnemonic.mockResolvedValue('invalid')

        const [, error] = await sdkStore.registerWithIndexer(
          mnemonic,
          testIndexerURL,
        )

        expect(error?.type).toBe('mnemonicMismatch')
        expect(mockInterfaceRegister).not.toHaveBeenCalled()
        // Pending approval kept so user can fix mnemonic and retry.
        expect(sdkStore.useSdkStore.getState().pendingApproval).not.toBeNull()
        expectCleanAuthState()
      })
    })

    describe('without pending approval (fallback browser auth)', () => {
      it('runs browser auth when no pending approval', async () => {
        const [, error] = await sdkStore.registerWithIndexer(
          mnemonic,
          testIndexerURL,
        )

        expect(error).toBeNull()
        // Browser auth runs.
        expect(mockRequestConnection).toHaveBeenCalled()
        expect(mockOpenAuthURL).toHaveBeenCalled()
        expect(mockWaitForApproval).toHaveBeenCalled()
        // Registration.
        expect(mockInterfaceRegister).toHaveBeenCalledWith(mnemonic)
        expect(sdkStore.getSdk()).toBe(mockSdk)
        expectCleanAuthState()
      })

      it('runs browser auth when pending approval is for different indexer', async () => {
        // Set pending approval for a different indexer.
        sdkStore.useSdkStore.setState({
          pendingApproval: {
            indexerURL: 'https://different-indexer.com',
            builder: mockBuilderInterface,
          },
        })

        const [, error] = await sdkStore.registerWithIndexer(
          mnemonic,
          testIndexerURL,
        )

        expect(error).toBeNull()
        // Browser auth runs because indexer URL doesn't match.
        expect(mockRequestConnection).toHaveBeenCalled()
        // Registration completes.
        expect(mockInterfaceRegister).toHaveBeenCalledWith(mnemonic)
        expectCleanAuthState()
      })

      it('user closes browser without approving, grace expires → cancelled', async () => {
        jest.useFakeTimers()
        try {
          mockOpenAuthURL.mockResolvedValue(false)
          mockWaitForApproval.mockImplementation(
            createAbortAwareMock(mockBuilderInterface).impl,
          )

          const promise = sdkStore.registerWithIndexer(mnemonic, testIndexerURL)
          await jest.advanceTimersByTimeAsync(BROWSER_CLOSE_GRACE_MS)
          const [, error] = await promise

          expect(error?.type).toBe('cancelled')
          expect(mockInterfaceRegister).not.toHaveBeenCalled()
          expectCleanAuthState()
        } finally {
          jest.useRealTimers()
        }
      })

      it('user approves (callback), poll succeeds within grace → registers successfully', async () => {
        jest.useFakeTimers()
        try {
          mockOpenAuthURL.mockImplementation(
            () =>
              new Promise((resolve) => setTimeout(() => resolve(true), 1_000)),
          )
          mockWaitForApproval.mockImplementation(
            createAbortAwareMock(mockBuilderInterface, 3_000).impl,
          )

          const promise = sdkStore.registerWithIndexer(mnemonic, testIndexerURL)
          await jest.advanceTimersByTimeAsync(3_000)
          const [, error] = await promise

          expect(error).toBeNull()
          expect(mockInterfaceRegister).toHaveBeenCalledWith(mnemonic)
          expect(sdkStore.getSdk()).toBe(mockSdk)
          expectCleanAuthState()
        } finally {
          jest.useRealTimers()
        }
      })

      it('cancelAuth() cancels register flow', async () => {
        jest.useFakeTimers()
        try {
          mockOpenAuthURL.mockImplementation(() => new Promise(() => {}))
          mockWaitForApproval.mockImplementation(
            createAbortAwareMock(mockBuilderInterface).impl,
          )

          const promise = sdkStore.registerWithIndexer(mnemonic, testIndexerURL)
          await jest.advanceTimersByTimeAsync(0)
          sdkStore.cancelAuth()
          await jest.advanceTimersByTimeAsync(0)
          const [, error] = await promise

          expect(error?.type).toBe('cancelled')
          expect(mockInterfaceRegister).not.toHaveBeenCalled()
          expect(mockCloseAuthBrowser).toHaveBeenCalled()
          expectCleanAuthState()
        } finally {
          jest.useRealTimers()
        }
      })
    })

    it('returns error when builder.register() fails', async () => {
      mockInterfaceRegister.mockRejectedValue(new Error('Registration failed'))

      const [, error] = await sdkStore.registerWithIndexer(
        mnemonic,
        testIndexerURL,
      )

      expect(error?.type).toBe('error')
      if (error?.type === 'error') {
        expect(error.message).toBe('Registration failed')
      }
      expect(mockSetAppKeyForIndexer).not.toHaveBeenCalled()
      expect(sdkStore.getSdk()).toBeNull()
      expectCleanAuthState()
    })

    it('returns error when builder.requestConnection() times out', async () => {
      jest.useFakeTimers()

      try {
        mockRequestConnection.mockImplementation(() => new Promise(() => {}))

        const registerPromise = sdkStore.registerWithIndexer(
          mnemonic,
          testIndexerURL,
        )
        await jest.advanceTimersByTimeAsync(10_000)
        const [, error] = await registerPromise

        expect(error?.type).toBe('error')
        if (error?.type === 'error') {
          expect(error.message).toBe('Connection timed out')
        }
        expect(mockInterfaceRegister).not.toHaveBeenCalled()
        expectCleanAuthState()
      } finally {
        jest.useRealTimers()
      }
    })

    it('returns error when builder.register() times out', async () => {
      jest.useFakeTimers()

      try {
        mockInterfaceRegister.mockImplementation(() => new Promise(() => {}))

        const registerPromise = sdkStore.registerWithIndexer(
          mnemonic,
          testIndexerURL,
        )
        await jest.advanceTimersByTimeAsync(10_000)
        const [, error] = await registerPromise

        expect(error?.type).toBe('error')
        if (error?.type === 'error') {
          expect(error.message).toBe('Connection timed out')
        }
        expect(mockSetAppKeyForIndexer).not.toHaveBeenCalled()
        expectCleanAuthState()
      } finally {
        jest.useRealTimers()
      }
    })
  })
})
