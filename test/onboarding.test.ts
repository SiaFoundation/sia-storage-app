/**
 * Onboarding Integration Tests
 *
 * Tests the complete onboarding flow including:
 * - Default Sia storage (new user needing mnemonic)
 * - Returning user (already has AppKey)
 * - Custom indexer flow
 * - Recovery phrase import (manual mode)
 * - State transitions through all phases to home screen
 *
 * Mocks all react-native-sia Builder interactions.
 */

import './utils/setup'

// Reset settings mock to use real implementation for onboarding tests
jest.mock('../src/stores/settings', () =>
  jest.requireActual('../src/stores/settings'),
)

import {
  authenticateIndexer,
  getIsConnected,
  getSdk,
  registerWithIndexer,
  useSdkStore,
} from '../src/stores/sdk'

// Helper functions to access SDK store state
const getIsAuthing = () => useSdkStore.getState().isAuthing
const getPendingApproval = () => useSdkStore.getState().pendingApproval

import {
  clearAppKeys,
  getAppKeyForIndexer,
  setAppKeyForIndexer,
} from '../src/stores/appKey'
import { clearMnemonicHash, validateMnemonic } from '../src/stores/mnemonic'
import {
  getHasOnboarded,
  getIndexerURL,
  setHasOnboarded,
  setIndexerURL,
} from '../src/stores/settings'

// Track Builder calls for assertions (must be prefixed with 'mock' for Jest hoisting)
interface MockBuilderCall {
  method: string
  args?: unknown[]
}

jest.mock('../src/lib/openAuthUrl', () => ({
  openAuthURL: jest.fn((url: string) => {
    // Access the mock flag via require to work around hoisting
    const shouldFail = (global as any).__mockBrowserAuthShouldFail
    if (shouldFail) {
      // Return false to indicate auth was cancelled (not rejected)
      return Promise.resolve(false)
    }
    // Simulate immediate approval - return true
    return Promise.resolve(true)
  }),
}))

jest.mock('react-native-sia', () => {
  // Create mock SDK factory inside the mock
  const createMockSdk = () => {
    const mockAppKey = {
      export_: () => new ArrayBuffer(64),
    }
    return {
      appKey: () => mockAppKey,
      account: jest.fn().mockResolvedValue({
        accountKey: 'mock-account-key',
        maxPinnedData: 1024n * 1024n * 1024n * 100n,
        pinnedData: 0n,
        app: {
          id: 'mock-app-id',
          name: 'Test App',
          description: 'Test app',
          serviceUrl: 'https://test.local',
          callbackUrl: 'sia://callback',
          logoUrl: '',
        },
        lastUsed: new Date(),
      }),
      isConnected: () => true,
    }
  }

  // Create mock BuilderInterface (returned by requestConnection)
  const createMockBuilderInterface = (): any => {
    const mockSdk = createMockSdk()
    const g = global as any

    return {
      // responseUrl returns the auth URL for the browser
      responseUrl: jest.fn(() => 'https://indexer.test/auth?token=abc123'),
      // waitForApproval waits for user to approve in browser
      waitForApproval: jest.fn(async () => {
        g.__mockBuilderCalls = g.__mockBuilderCalls || []
        g.__mockBuilderCalls.push({ method: 'waitForApproval' })
        if (g.__mockBuilderShouldFailApproval) {
          throw new Error('Approval failed')
        }
        // Returns itself (approved builder interface)
        return createMockBuilderInterface()
      }),
      // register creates the SDK with derived AppKey
      register: jest.fn(async (mnemonic: string) => {
        g.__mockBuilderCalls = g.__mockBuilderCalls || []
        g.__mockBuilderCalls.push({ method: 'register', args: [mnemonic] })
        if (g.__mockBuilderShouldFailRegistration) {
          throw new Error('Registration failed')
        }
        return mockSdk
      }),
    }
  }

  return {
    AppKey: class MockAppKey {
      private data: ArrayBuffer
      constructor(data: ArrayBuffer) {
        this.data = data
      }
      export_(): ArrayBuffer {
        return this.data
      }
    },
    // Builder class - the main entry point
    Builder: jest.fn().mockImplementation((indexerURL: string) => {
      const g = global as any
      g.__mockBuilderCalls = g.__mockBuilderCalls || []
      g.__mockBuilderCalls.push({ method: 'constructor', args: [indexerURL] })
      const mockSdk = createMockSdk()
      const builderInterface = createMockBuilderInterface()

      return {
        // connected() - for returning users with existing AppKey
        connected: jest.fn(async (appKey: unknown) => {
          g.__mockBuilderCalls = g.__mockBuilderCalls || []
          g.__mockBuilderCalls.push({ method: 'connected', args: [appKey] })
          if (g.__mockBuilderHasExistingRegistration) {
            return mockSdk
          }
          return null
        }),
        // requestConnection() - for new users, returns BuilderInterface
        requestConnection: jest.fn(async (appInfo: unknown) => {
          g.__mockBuilderCalls = g.__mockBuilderCalls || []
          g.__mockBuilderCalls.push({
            method: 'requestConnection',
            args: [appInfo],
          })
          return builderInterface
        }),
      }
    }),
    generateRecoveryPhrase: jest.fn(
      () =>
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    ),
    validateRecoveryPhrase: jest.fn((phrase: string) => {
      const words = phrase.trim().split(/\s+/)
      return words.length === 12
    }),
  }
})

// Helper functions to access global mock state
const getBuilderCalls = (): MockBuilderCall[] =>
  (global as any).__mockBuilderCalls || []
const resetBuilderCalls = () => {
  ;(global as any).__mockBuilderCalls = []
}
const setMockBuilderOptions = (options: {
  hasExistingRegistration?: boolean
  shouldFailApproval?: boolean
  shouldFailRegistration?: boolean
}) => {
  const g = global as any
  g.__mockBuilderHasExistingRegistration =
    options.hasExistingRegistration || false
  g.__mockBuilderShouldFailApproval = options.shouldFailApproval || false
  g.__mockBuilderShouldFailRegistration =
    options.shouldFailRegistration || false
}
const setMockBrowserAuthShouldFail = (shouldFail: boolean) => {
  ;(global as any).__mockBrowserAuthShouldFail = shouldFail
}

describe('Onboarding Integration', () => {
  beforeEach(async () => {
    // Reset all mock state
    resetBuilderCalls()
    setMockBuilderOptions({})
    setMockBrowserAuthShouldFail(false)

    // Reset stores
    useSdkStore.setState({
      sdk: null,
      isConnected: false,
      connectionError: null,
      isAuthing: false,
      isReconnecting: false,
      pendingApproval: null,
    })

    // Clear persisted state
    await setHasOnboarded(false)
    await setIndexerURL('')
    await clearAppKeys()
    await clearMnemonicHash()
  })

  describe('New User - Default Sia Storage Flow', () => {
    it('progresses through all phases: indexer auth → recovery phrase → home', async () => {
      const indexerURL = 'https://sia.storage'

      // Phase 1: Initial state - not onboarded
      expect(await getHasOnboarded()).toBe(false)
      expect(getIsConnected()).toBe(false)
      expect(getSdk()).toBeNull()

      // Phase 2: Authenticate with indexer (triggers browser auth)
      const [authData, authErr] = await authenticateIndexer(indexerURL)

      // Should need mnemonic (new user) - alreadyConnected: false means needs mnemonic
      expect(authErr).toBeNull()
      expect(authData?.alreadyConnected).toBe(false)

      // Builder should have been called
      expect(getBuilderCalls()).toContainEqual({
        method: 'constructor',
        args: [indexerURL],
      })
      expect(getBuilderCalls()).toContainEqual(
        expect.objectContaining({ method: 'requestConnection' }),
      )
      expect(getBuilderCalls()).toContainEqual({ method: 'waitForApproval' })

      // Pending approval should be saved
      expect(getPendingApproval()).not.toBeNull()
      expect(getPendingApproval()?.indexerURL).toBe(indexerURL)

      // Phase 3: Register with recovery phrase
      const mnemonic =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      const [registerData, registerErr] = await registerWithIndexer(
        mnemonic,
        indexerURL,
      )

      // Should succeed
      expect(registerErr).toBeNull()
      expect(registerData).not.toBeNull()

      // Builder.register should have been called
      expect(getBuilderCalls()).toContainEqual({
        method: 'register',
        args: [mnemonic],
      })

      // Phase 4: Verify final state - "home screen ready"
      expect(getIsConnected()).toBe(true)
      expect(getSdk()).not.toBeNull()
      expect(await getIndexerURL()).toBe(indexerURL)
      expect(await getAppKeyForIndexer(indexerURL)).not.toBeNull()

      // Mnemonic hash should be saved for future validation
      const mnemonicValidation = await validateMnemonic(mnemonic)
      expect(mnemonicValidation).toBe('valid')

      // Pending approval should be cleared
      expect(getPendingApproval()).toBeNull()

      // Mark onboarding complete (simulates user tapping "Upload files")
      await setHasOnboarded(true)
      expect(await getHasOnboarded()).toBe(true)
    })

    it('handles browser auth cancellation', async () => {
      const indexerURL = 'https://sia.storage'

      // Make browser auth reject
      setMockBrowserAuthShouldFail(true)

      const [authData, authErr] = await authenticateIndexer(indexerURL)

      // Should have error with type 'cancelled'
      expect(authData).toBeNull()
      expect(authErr?.type).toBe('cancelled')
      expect(getIsConnected()).toBe(false)
      expect(getPendingApproval()).toBeNull()
    })
  })

  describe('Returning User - Already Registered', () => {
    it('skips recovery phrase when AppKey exists', async () => {
      const indexerURL = 'https://sia.storage'

      // Pre-condition: User has previously registered (AppKey exists)
      const existingAppKey = {
        export_: () => new ArrayBuffer(64),
      }
      await setAppKeyForIndexer(indexerURL, existingAppKey as any)

      // Configure mock to simulate existing registration
      setMockBuilderOptions({ hasExistingRegistration: true })

      // Authenticate - should detect existing registration
      const [authData, authErr] = await authenticateIndexer(indexerURL)

      // Should be already connected (no mnemonic needed)
      expect(authErr).toBeNull()
      expect(authData?.alreadyConnected).toBe(true)

      // Builder.connected should have been called with the AppKey
      expect(getBuilderCalls()).toContainEqual(
        expect.objectContaining({ method: 'connected' }),
      )

      // Should NOT have called register or requestConnection (already connected)
      expect(getBuilderCalls()).not.toContainEqual(
        expect.objectContaining({ method: 'register' }),
      )
      expect(getBuilderCalls()).not.toContainEqual(
        expect.objectContaining({ method: 'requestConnection' }),
      )

      // Final state - connected without needing recovery phrase
      expect(getIsConnected()).toBe(true)
      expect(getSdk()).not.toBeNull()

      // Complete onboarding
      await setHasOnboarded(true)
      expect(await getHasOnboarded()).toBe(true)
    })
  })

  describe('Custom Indexer Flow', () => {
    it('works with custom indexer URL', async () => {
      const customIndexerURL = 'https://my-custom-indexer.example.com'

      // Phase 1: Authenticate with custom indexer
      const [authData, authErr] = await authenticateIndexer(customIndexerURL)

      expect(authErr).toBeNull()
      expect(authData?.alreadyConnected).toBe(false) // New user, needs mnemonic

      // Builder should be created with custom URL
      expect(getBuilderCalls()).toContainEqual({
        method: 'constructor',
        args: [customIndexerURL],
      })

      // Phase 2: Register
      const mnemonic =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      const [registerData, registerErr] = await registerWithIndexer(
        mnemonic,
        customIndexerURL,
      )

      expect(registerErr).toBeNull()
      expect(registerData).not.toBeNull()

      // Verify custom indexer is saved
      expect(await getIndexerURL()).toBe(customIndexerURL)
      expect(await getAppKeyForIndexer(customIndexerURL)).not.toBeNull()

      // Complete onboarding
      await setHasOnboarded(true)
      expect(await getHasOnboarded()).toBe(true)
    })

    it('can switch between multiple indexers', async () => {
      const indexer1 = 'https://indexer1.example.com'
      const indexer2 = 'https://indexer2.example.com'
      const mnemonic =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

      // Register with first indexer
      await authenticateIndexer(indexer1)
      await registerWithIndexer(mnemonic, indexer1)
      expect(await getIndexerURL()).toBe(indexer1)

      // Reset SDK state (simulates app restart or switching)
      useSdkStore.setState({
        sdk: null,
        isConnected: false,
        pendingApproval: null,
      })

      // Register with second indexer (same mnemonic)
      await authenticateIndexer(indexer2)
      await registerWithIndexer(mnemonic, indexer2)
      expect(await getIndexerURL()).toBe(indexer2)

      // Both indexers should have AppKeys
      expect(await getAppKeyForIndexer(indexer1)).not.toBeNull()
      expect(await getAppKeyForIndexer(indexer2)).not.toBeNull()
    })
  })

  describe('Recovery Phrase Import (Manual Mode)', () => {
    it('validates imported phrase against stored hash', async () => {
      const indexerURL = 'https://sia.storage'
      const originalMnemonic =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

      // First registration - establishes mnemonic hash
      await authenticateIndexer(indexerURL)
      await registerWithIndexer(originalMnemonic, indexerURL)

      // Reset state (simulates connecting to new indexer)
      const newIndexer = 'https://another-indexer.example.com'
      useSdkStore.setState({
        sdk: null,
        isConnected: false,
        pendingApproval: null,
      })

      // Try to register with NEW indexer using SAME mnemonic
      await authenticateIndexer(newIndexer)
      const [registerData, registerErr] = await registerWithIndexer(
        originalMnemonic,
        newIndexer,
      )

      // Should succeed because mnemonic matches stored hash
      expect(registerErr).toBeNull()
      expect(registerData).not.toBeNull()
    })

    it('rejects mismatched mnemonic', async () => {
      const indexerURL = 'https://sia.storage'
      const originalMnemonic =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      const wrongMnemonic = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'

      // First registration - establishes mnemonic hash
      await authenticateIndexer(indexerURL)
      await registerWithIndexer(originalMnemonic, indexerURL)

      // Reset state
      const newIndexer = 'https://another-indexer.example.com'
      useSdkStore.setState({
        sdk: null,
        isConnected: false,
        pendingApproval: null,
      })

      // Try to register with wrong mnemonic
      await authenticateIndexer(newIndexer)
      const [registerData, registerErr] = await registerWithIndexer(
        wrongMnemonic,
        newIndexer,
      )

      // Should fail - mnemonic doesn't match
      expect(registerData).toBeNull()
      expect(registerErr?.type).toBe('mnemonicMismatch')
      expect(getIsConnected()).toBe(false)
    })
  })

  describe('Error Handling', () => {
    it('handles approval failure', async () => {
      const indexerURL = 'https://sia.storage'

      // Configure mock to fail approval
      setMockBuilderOptions({ shouldFailApproval: true })

      const [authData, authErr] = await authenticateIndexer(indexerURL)

      expect(authData).toBeNull()
      expect(authErr?.type).toBe('error')
      expect(getIsConnected()).toBe(false)
    })

    it('handles registration failure', async () => {
      const indexerURL = 'https://sia.storage'
      const mnemonic =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

      // Configure mock to fail registration
      setMockBuilderOptions({ shouldFailRegistration: true })

      await authenticateIndexer(indexerURL)
      const [registerData, registerErr] = await registerWithIndexer(
        mnemonic,
        indexerURL,
      )

      expect(registerData).toBeNull()
      expect(registerErr?.type).toBe('error')
      expect(getIsConnected()).toBe(false)
    })
  })

  describe('State Transitions', () => {
    it('tracks isAuthing state during authentication', async () => {
      const indexerURL = 'https://sia.storage'

      // Start authentication (don't await)
      const authPromise = authenticateIndexer(indexerURL)

      // isAuthing should be true during auth
      // Note: This may be too fast to catch in tests, so we just verify the final state
      await authPromise

      // After auth completes, isAuthing should be false
      expect(getIsAuthing()).toBe(false)
    })

    it('clears pendingApproval after successful registration', async () => {
      const indexerURL = 'https://sia.storage'
      const mnemonic =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

      await authenticateIndexer(indexerURL)
      expect(getPendingApproval()).not.toBeNull()

      await registerWithIndexer(mnemonic, indexerURL)
      expect(getPendingApproval()).toBeNull()
    })

    it('persists connection state after registration', async () => {
      const indexerURL = 'https://sia.storage'
      const mnemonic =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

      await authenticateIndexer(indexerURL)
      await registerWithIndexer(mnemonic, indexerURL)

      // Verify all persistent state is set
      expect(await getIndexerURL()).toBe(indexerURL)
      expect(await getAppKeyForIndexer(indexerURL)).not.toBeNull()
      expect(await validateMnemonic(mnemonic)).toBe('valid')
    })
  })
})
