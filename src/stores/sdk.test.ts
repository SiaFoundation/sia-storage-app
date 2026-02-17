import type { AppKey, BuilderInterface, SdkInterface } from 'react-native-sia'
import { openAuthURL } from '../lib/openAuthUrl'
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
jest.mock('../lib/openAuthUrl', () => ({ openAuthURL: jest.fn() }))
jest.mock('../lib/logger', () => ({ logger: { log: jest.fn() } }))
jest.mock('../config', () => ({ APP_KEY: '0'.repeat(64) }))

const mockGetAppKey = jest.mocked(getAppKey)
const mockGetAppKeyForIndexer = jest.mocked(getAppKeyForIndexer)
const mockSetAppKeyForIndexer = jest.mocked(setAppKeyForIndexer)
const mockSetMnemonicHash = jest.mocked(setMnemonicHash)
const mockValidateMnemonic = jest.mocked(validateMnemonic)
const mockGetIndexerURL = jest.mocked(getIndexerURL)
const mockSetIndexerURL = jest.mocked(setIndexerURL)
const mockOpenAuthURL = jest.mocked(openAuthURL)

describe('sdk store', () => {
  let mockAppKey: AppKey
  let mockSdk: SdkInterface
  let mockBuilderInterface: BuilderInterface

  beforeEach(() => {
    jest.clearAllMocks()
    sdkStore.resetSdk()

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
        'Failed to connect to indexer',
      )
      expect(sdkStore.useSdkStore.getState().isReconnecting).toBe(false)
    })

    it('returns false if no AppKey yet', async () => {
      mockGetAppKey.mockRejectedValue(new Error('No AppKey'))

      const result = await sdkStore.reconnectIndexer()

      expect(result).toBe(false)
      expect(sdkStore.getIsConnected()).toBe(false)
      expect(sdkStore.useSdkStore.getState().connectionError).toBe(
        'Failed to connect to indexer',
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
      mockOpenAuthURL.mockResolvedValue(true)
      mockWaitForApproval.mockResolvedValue(mockBuilderInterface)
    })

    describe('new user (no AppKey)', () => {
      beforeEach(() => {
        mockGetAppKeyForIndexer.mockResolvedValue(undefined)
      })

      it('runs browser auth, saves pending approval, returns alreadyConnected: false', async () => {
        const [result, error] = await sdkStore.authenticateIndexer(indexerUrl)

        expect(error).toBeNull()
        expect(result?.alreadyConnected).toBe(false)
        // Browser auth flow was run.
        expect(mockRequestConnection).toHaveBeenCalled()
        expect(mockOpenAuthURL).toHaveBeenCalled()
        expect(mockWaitForApproval).toHaveBeenCalled()
        // Pending approval saved for registerWithIndexer.
        expect(sdkStore.useSdkStore.getState().pendingApproval).toEqual({
          indexerURL: indexerUrl,
          builder: mockBuilderInterface,
        })
        // SDK not set yet - waiting for registerWithIndexer.
        expect(sdkStore.getSdk()).toBeNull()
        expect(sdkStore.getIsConnected()).toBe(false)
        // Indexer URL NOT saved yet - deferred to registerWithIndexer.
        expect(mockSetIndexerURL).not.toHaveBeenCalled()
        expectCleanAuthState()
      })

      it('returns cancelled when user cancels browser auth', async () => {
        mockOpenAuthURL.mockResolvedValue(false)

        const [, error] = await sdkStore.authenticateIndexer(indexerUrl)

        expect(error?.type).toBe('cancelled')
        expectCleanAuthState()
      })

      it('returns error when builder.requestConnection() fails', async () => {
        mockRequestConnection.mockRejectedValue(new Error('Request failed'))

        const [, error] = await sdkStore.authenticateIndexer(indexerUrl)

        expect(error?.type).toBe('error')
        if (error?.type === 'error') {
          expect(error.message).toBe('Request failed')
        }
        expectCleanAuthState()
      })
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
        expect(mockGetAppKeyForIndexer).toHaveBeenCalledWith(indexerUrl)
        expect(mockConnected).toHaveBeenCalledWith(mockAppKey)
        // No browser auth needed.
        expect(mockRequestConnection).not.toHaveBeenCalled()
        expect(mockOpenAuthURL).not.toHaveBeenCalled()
        // SDK connected.
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
        expect(sdkStore.getSdk()).toBeNull()
        expect(mockSetIndexerURL).not.toHaveBeenCalled()
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
          expect(sdkStore.getSdk()).toBeNull()
          expect(mockSetIndexerURL).not.toHaveBeenCalled()
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
        // Should fall through to browser auth.
        expect(mockConnected).toHaveBeenCalledWith(mockAppKey)
        expect(mockRequestConnection).toHaveBeenCalled()
        expect(mockOpenAuthURL).toHaveBeenCalled()
        expect(mockWaitForApproval).toHaveBeenCalled()
        // Pending approval saved.
        expect(sdkStore.useSdkStore.getState().pendingApproval).toEqual({
          indexerURL: indexerUrl,
          builder: mockBuilderInterface,
        })
        expect(sdkStore.getSdk()).toBeNull()
        expectCleanAuthState()
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
      mockOpenAuthURL.mockResolvedValue(true)
      mockWaitForApproval.mockResolvedValue(mockBuilderInterface)
      mockInterfaceRegister.mockResolvedValue(mockSdk)
    })

    describe('with pending approval from authenticateIndexer', () => {
      beforeEach(() => {
        // Set pending approval as if authenticateIndexer was called.
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

    describe('without pending approval (fallback)', () => {
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
        expect(mockOpenAuthURL).toHaveBeenCalled()
        expect(mockWaitForApproval).toHaveBeenCalled()
        // Registration completes.
        expect(mockInterfaceRegister).toHaveBeenCalledWith(mnemonic)
        expect(sdkStore.getSdk()).toBe(mockSdk)
        expectCleanAuthState()
      })

      it('returns cancelled when user closes browser', async () => {
        mockOpenAuthURL.mockResolvedValue(false)

        const [, error] = await sdkStore.registerWithIndexer(
          mnemonic,
          testIndexerURL,
        )

        expect(error?.type).toBe('cancelled')
        expect(mockInterfaceRegister).not.toHaveBeenCalled()
        expect(mockSetAppKeyForIndexer).not.toHaveBeenCalled()
        expect(sdkStore.getSdk()).toBeNull()
        expectCleanAuthState()
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
      expect(sdkStore.getIsConnected()).toBe(false)
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
        expect(mockSetAppKeyForIndexer).not.toHaveBeenCalled()
        expect(sdkStore.getSdk()).toBeNull()
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
        expect(mockSetMnemonicHash).not.toHaveBeenCalled()
        expect(sdkStore.getSdk()).toBeNull()
        expectCleanAuthState()
      } finally {
        jest.useRealTimers()
      }
    })

    it('returns error when builder.waitForApproval() times out (fallback path)', async () => {
      jest.useFakeTimers()

      try {
        mockWaitForApproval.mockImplementation(() => new Promise(() => {}))

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
        expect(mockSetAppKeyForIndexer).not.toHaveBeenCalled()
        expect(sdkStore.getSdk()).toBeNull()
        expectCleanAuthState()
      } finally {
        jest.useRealTimers()
      }
    })
  })

  describe('switchIndexer', () => {
    const indexerUrl = 'https://new-indexer.example.com'

    describe('with stored AppKey for this indexer', () => {
      beforeEach(() => {
        mockGetAppKeyForIndexer.mockResolvedValue(mockAppKey)
        mockConnected.mockResolvedValue(mockSdk)
      })

      it('connects immediately and returns success', async () => {
        const [, error] = await sdkStore.switchIndexer(indexerUrl)

        expect(error).toBeNull()
        expect(mockGetAppKeyForIndexer).toHaveBeenCalledWith(indexerUrl)
        expect(mockConnected).toHaveBeenCalledWith(mockAppKey)
        expect(sdkStore.getSdk()).toBe(mockSdk)
        expect(sdkStore.getIsConnected()).toBe(true)
        expect(mockSetIndexerURL).toHaveBeenCalledWith(indexerUrl)
        // No auth flow needed.
        expect(mockRequestConnection).not.toHaveBeenCalled()
        expect(mockOpenAuthURL).not.toHaveBeenCalled()
      })
    })

    describe('without stored AppKey for this indexer', () => {
      beforeEach(() => {
        mockGetAppKeyForIndexer.mockResolvedValue(undefined)
      })

      it('returns needsReauth', async () => {
        const [, error] = await sdkStore.switchIndexer(indexerUrl)

        expect(error?.type).toBe('needsReauth')
        expect(mockGetAppKeyForIndexer).toHaveBeenCalledWith(indexerUrl)
        expect(mockConnected).not.toHaveBeenCalled()
        expect(sdkStore.getSdk()).toBeNull()
        expect(mockSetIndexerURL).not.toHaveBeenCalled()
      })
    })

    describe('with stored AppKey but builder.connected() returns null', () => {
      beforeEach(() => {
        mockGetAppKeyForIndexer.mockResolvedValue(mockAppKey)
        // builder.connected() returns null - unexpected, but handle gracefully.
        mockConnected.mockResolvedValue(null)
      })

      it('returns needsReauth', async () => {
        const [, error] = await sdkStore.switchIndexer(indexerUrl)

        expect(error?.type).toBe('needsReauth')
        expect(mockConnected).toHaveBeenCalledWith(mockAppKey)
        expect(sdkStore.getSdk()).toBeNull()
        expect(sdkStore.getIsConnected()).toBe(false)
        expect(mockSetIndexerURL).not.toHaveBeenCalled()
      })
    })

    describe('connection error', () => {
      beforeEach(() => {
        mockGetAppKeyForIndexer.mockResolvedValue(mockAppKey)
        mockConnected.mockRejectedValue(new Error('Network error'))
      })

      it('returns error with message', async () => {
        const [, error] = await sdkStore.switchIndexer(indexerUrl)

        expect(error?.type).toBe('error')
        if (error?.type === 'error') {
          expect(error.message).toBe('Network error')
        }
        expect(sdkStore.getSdk()).toBeNull()
        expect(mockSetIndexerURL).not.toHaveBeenCalled()
      })
    })

    describe('timeout', () => {
      it('returns error when builder.connected() times out', async () => {
        jest.useFakeTimers()

        try {
          mockGetAppKeyForIndexer.mockResolvedValue(mockAppKey)
          mockConnected.mockImplementation(() => new Promise(() => {}))

          const switchPromise = sdkStore.switchIndexer(indexerUrl)
          await jest.advanceTimersByTimeAsync(10_000)
          const [, error] = await switchPromise

          expect(error?.type).toBe('error')
          if (error?.type === 'error') {
            expect(error.message).toBe('Connection timed out')
          }
          expect(sdkStore.getSdk()).toBeNull()
          expect(mockSetIndexerURL).not.toHaveBeenCalled()
        } finally {
          jest.useRealTimers()
        }
      })
    })
  })
})
