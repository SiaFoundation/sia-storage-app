import { createNodeSdkAuthAdapter } from '../src/auth'

// Mock @siafoundation/sia-storage module for testing
jest.mock('@siafoundation/sia-storage', () => {
  const mockSdk = {
    appKey: () => ({
      export: () => Buffer.alloc(32),
      publicKey: () => 'ed25519:test',
      sign: (_msg: Buffer) => Buffer.alloc(64),
      verifySignature: () => true,
    }),
    _native: {},
  }

  let approvalResolve: (() => void) | null = null
  let connectResult: any = mockSdk

  const MockBuilder = jest.fn().mockImplementation(() => ({
    requestConnection: jest.fn().mockResolvedValue(undefined),
    responseUrl: jest.fn().mockReturnValue('https://sia.storage/approve?token=abc'),
    waitForApproval: jest.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          approvalResolve = resolve
        }),
    ),
    connected: jest.fn().mockImplementation(async () => connectResult),
    register: jest.fn().mockResolvedValue(mockSdk),
  }))

  return {
    Builder: MockBuilder,
    AppKey: jest.fn().mockImplementation((seed: Buffer) => ({
      export: () => seed,
      publicKey: () => 'ed25519:test',
      _native: {},
    })),
    initSia: jest.fn().mockResolvedValue(undefined),
    setLogger: jest.fn(),
    generateRecoveryPhrase: jest
      .fn()
      .mockReturnValue(
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      ),
    validateRecoveryPhrase: jest.fn(),
    // Expose test helpers
    __test__: {
      resolveApproval: () => approvalResolve?.(),
      setConnectResult: (result: any) => {
        connectResult = result
      },
    },
  }
})

const siaStorage = require('@siafoundation/sia-storage')

describe('createNodeSdkAuthAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    siaStorage.__test__.setConnectResult({
      appKey: () => ({
        export: () => new Uint8Array(32),
        publicKey: () => 'ed25519:test',
      }),
      _native: {},
    })
  })

  it('createBuilder parses appMetaJson and creates builder', async () => {
    const { adapters } = createNodeSdkAuthAdapter()
    await adapters.createBuilder(
      'https://sia.storage',
      JSON.stringify({
        appID: '00'.repeat(32),
        name: 'Test',
        description: 'Test app',
        serviceURL: 'https://test.com',
      }),
    )
    expect(siaStorage.Builder).toHaveBeenCalledWith(
      'https://sia.storage',
      expect.objectContaining({
        name: 'Test',
        description: 'Test app',
        serviceUrl: 'https://test.com',
      }),
    )
  })

  it('requestConnection returns approval URL', async () => {
    const { adapters } = createNodeSdkAuthAdapter()
    await adapters.createBuilder(
      'https://sia.storage',
      JSON.stringify({
        appID: '00'.repeat(32),
        name: 'Test',
        description: 'Test',
        serviceURL: 'https://test.com',
      }),
    )
    const url = await adapters.requestConnection()
    expect(url).toBe('https://sia.storage/approve?token=abc')
  })

  it('connectWithKey returns true when connected', async () => {
    const { adapters, getLastSdk } = createNodeSdkAuthAdapter()
    await adapters.createBuilder(
      'https://sia.storage',
      JSON.stringify({
        appID: '00'.repeat(32),
        name: 'Test',
        description: 'Test',
        serviceURL: 'https://test.com',
      }),
    )
    const connected = await adapters.connectWithKey('ab'.repeat(32))
    expect(connected).toBe(true)
    expect(getLastSdk()).not.toBeNull()
  })

  it('connectWithKey returns false when not connected', async () => {
    siaStorage.__test__.setConnectResult(null)
    const { adapters, getLastSdk } = createNodeSdkAuthAdapter()
    await adapters.createBuilder(
      'https://sia.storage',
      JSON.stringify({
        appID: '00'.repeat(32),
        name: 'Test',
        description: 'Test',
        serviceURL: 'https://test.com',
      }),
    )
    const connected = await adapters.connectWithKey('ab'.repeat(32))
    expect(connected).toBe(false)
    expect(getLastSdk()).toBeNull()
  })

  it('register returns appKeyHex and stashes sdk', async () => {
    const { adapters, getLastSdk } = createNodeSdkAuthAdapter()
    await adapters.createBuilder(
      'https://sia.storage',
      JSON.stringify({
        appID: '00'.repeat(32),
        name: 'Test',
        description: 'Test',
        serviceURL: 'https://test.com',
      }),
    )
    const hex = await adapters.register(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    )
    expect(typeof hex).toBe('string')
    expect(hex.length).toBe(64) // 32 bytes as hex
    expect(getLastSdk()).not.toBeNull()
  })

  it('generateRecoveryPhrase returns 12-word phrase', () => {
    const { adapters } = createNodeSdkAuthAdapter()
    const phrase = adapters.generateRecoveryPhrase()
    expect(typeof phrase).toBe('string')
    const words = (phrase as string).split(' ')
    expect(words.length).toBe(12)
  })

  it('validateRecoveryPhrase delegates to sia-storage', () => {
    const { adapters } = createNodeSdkAuthAdapter()
    adapters.validateRecoveryPhrase('test phrase')
    expect(siaStorage.validateRecoveryPhrase).toHaveBeenCalledWith('test phrase')
  })

  it('cancelAuth aborts pending waitForApproval', async () => {
    const { adapters } = createNodeSdkAuthAdapter()
    await adapters.createBuilder(
      'https://sia.storage',
      JSON.stringify({
        appID: '00'.repeat(32),
        name: 'Test',
        description: 'Test',
        serviceURL: 'https://test.com',
      }),
    )

    const waitPromise = adapters.waitForApproval()
    adapters.cancelAuth()
    await expect(waitPromise).rejects.toThrow('Auth cancelled')
  })

  it('throws if no builder instance', async () => {
    const { adapters } = createNodeSdkAuthAdapter()
    await expect(adapters.requestConnection()).rejects.toThrow('No builder instance')
    await expect(adapters.waitForApproval()).rejects.toThrow('No builder instance')
    await expect(adapters.connectWithKey('ab'.repeat(32))).rejects.toThrow('No builder instance')
    await expect(adapters.register('test')).rejects.toThrow('No builder instance')
  })
})
