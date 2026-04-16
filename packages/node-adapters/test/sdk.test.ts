import { AddressProtocol } from '@siastorage/core/adapters'
import { createNodeSdkAdapter } from '../src/sdk'

// Mock sia-storage types that mirror the real classes
function createMockAppKey() {
  const seed = Buffer.alloc(32, 0xab)
  return {
    publicKey: () => 'ed25519:abcdef0123456789',
    sign: (msg: Uint8Array) => Buffer.from([...msg].reverse()),
    verifySignature: (_msg: Uint8Array, _sig: Uint8Array) => true,
    export: () => new Uint8Array(seed),
    _native: {} as any,
  }
}

function createMockPinnedObject(id = 'obj-1') {
  const metadata = Buffer.from(JSON.stringify({ name: 'test.txt' }))
  return {
    id: () => id,
    size: () => BigInt(1024),
    encodedSize: () => BigInt(2048),
    metadata: () => new Uint8Array(metadata),
    updateMetadata: jest.fn(),
    seal: (appKey: any) => ({
      id,
      encryptedDataKey: Buffer.alloc(32),
      encryptedMetadataKey: Buffer.alloc(32),
      slabs: [
        {
          encryptionKey: Buffer.alloc(32),
          minShards: 10,
          sectors: [{ root: 'abc', hostKey: 'host1' }],
          offset: 0,
          length: 4096,
        },
      ],
      encryptedMetadata: Buffer.alloc(16),
      dataSignature: Buffer.alloc(64),
      metadataSignature: Buffer.alloc(64),
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-02'),
    }),
    slabs: () => [
      {
        encryptionKey: Buffer.alloc(32),
        minShards: 10,
        sectors: [{ root: 'abc', hostKey: 'host1' }],
        offset: 0,
        length: 4096,
      },
    ],
    createdAt: () => new Date('2024-01-01'),
    updatedAt: () => new Date('2024-01-02'),
    _native: {} as any,
  }
}

function createMockSdk() {
  const appKey = createMockAppKey()
  const pinnedObj = createMockPinnedObject()

  return {
    appKey: () => appKey,
    objectEvents: jest.fn(async () => [
      {
        id: 'evt-1',
        deleted: false,
        updatedAt: new Date('2024-01-01'),
        object: pinnedObj,
      },
      {
        id: 'evt-2',
        deleted: true,
        updatedAt: new Date('2024-01-02'),
        object: null,
      },
    ]),
    updateObjectMetadata: jest.fn(async () => {}),
    download: jest.fn((_obj: any, _opts: any) => {
      // New SDK shape: returns a ReadableStream of bytes
      const data = Buffer.from('downloaded data')
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(data))
          controller.close()
        },
      })
    }),
    uploadPacked: jest.fn((_opts: any) => ({
      add: jest.fn(async (stream: ReadableStream<Uint8Array>) => {
        const reader = stream.getReader()
        let total = 0
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          total += value.byteLength
        }
        return BigInt(total)
      }),
      cancel: jest.fn(async () => {}),
      finalize: jest.fn(async () => [pinnedObj]),
      length: () => BigInt(100),
      remaining: () => BigInt(50),
      slabs: () => BigInt(1),
    })),
    pinObject: jest.fn(async () => {}),
    deleteObject: jest.fn(async () => {}),
    object: jest.fn(async () => pinnedObj),
    shareObject: jest.fn(() => 'https://share.example.com/abc'),
    sharedObject: jest.fn(async () => pinnedObj),
    hosts: jest.fn(async () => [
      {
        publicKey: 'host-pk-1',
        addresses: [
          { protocol: 'SiaMux' as const, address: '1.2.3.4:9981' },
          { protocol: 'Quic' as const, address: '1.2.3.4:9982' },
        ],
        countryCode: 'US',
        latitude: 37.7,
        longitude: -122.4,
        goodForUpload: true,
      },
    ]),
    account: jest.fn(async () => ({
      accountKey: 'acct-key-1',
      maxPinnedData: BigInt(1_000_000_000),
      remainingStorage: BigInt(500_000_000),
      pinnedData: BigInt(500_000_000),
      pinnedSize: BigInt(600_000_000),
      ready: true,
      app: {
        id: 'app-1',
        name: 'TestApp',
        description: 'Test application',
        serviceUrl: 'https://test.example.com',
        logoUrl: 'https://test.example.com/logo.png',
      },
      lastUsed: new Date('2024-06-01'),
    })),
    _native: {} as any,
  }
}

describe('createNodeSdkAdapter', () => {
  it('appKey returns wrapped AppKeyRef', () => {
    const mockSdk = createMockSdk()
    const adapter = createNodeSdkAdapter(mockSdk as any)
    const key = adapter.appKey()
    expect(key.publicKey()).toBe('ed25519:abcdef0123456789')
    expect(key.export_()).toBeInstanceOf(ArrayBuffer)
    expect(key.export_().byteLength).toBe(32)
  })

  it('appKey sign/verify converts between ArrayBuffer and Uint8Array', () => {
    const mockSdk = createMockSdk()
    const adapter = createNodeSdkAdapter(mockSdk as any)
    const key = adapter.appKey()
    const message = new ArrayBuffer(4)
    new Uint8Array(message).set([1, 2, 3, 4])
    const sig = key.sign(message)
    expect(sig).toBeInstanceOf(ArrayBuffer)
    expect(key.verifySignature(message, sig)).toBe(true)
  })

  it('objectEvents maps events correctly', async () => {
    const mockSdk = createMockSdk()
    const adapter = createNodeSdkAdapter(mockSdk as any)
    const events = await adapter.objectEvents(undefined, 100)
    expect(events).toHaveLength(2)
    expect(events[0].id).toBe('evt-1')
    expect(events[0].object).toBeDefined()
    expect(events[0].object!.id()).toBe('obj-1')
    expect(events[1].id).toBe('evt-2')
    expect(events[1].deleted).toBe(true)
    expect(events[1].object).toBeUndefined()
  })

  it('download returns a DownloadLikeRef yielding ArrayBuffer chunks', async () => {
    const mockSdk = createMockSdk()
    const adapter = createNodeSdkAdapter(mockSdk as any)

    // First get a pinned object through the adapter so it's registered in WeakMap
    const obj = await adapter.getPinnedObject('test')
    const dl = await adapter.download(obj, {
      maxInflight: 1,
      offset: BigInt(0),
      length: undefined,
    })
    const chunks: ArrayBuffer[] = []
    while (true) {
      const chunk = await dl.read()
      if (chunk.byteLength === 0) break
      chunks.push(chunk)
    }
    await dl.cancel()
    expect(chunks.length).toBe(1)
    expect(chunks[0]).toBeInstanceOf(ArrayBuffer)
    expect(Buffer.from(chunks[0]).toString()).toBe('downloaded data')
  })

  it('uploadPacked passes options correctly', async () => {
    const mockSdk = createMockSdk()
    const adapter = createNodeSdkAdapter(mockSdk as any)
    const packed = await adapter.uploadPacked({
      maxInflight: 10,
      dataShards: 10,
      parityShards: 3,
    })
    expect(packed.length()).toBe(BigInt(100))
    expect(packed.remaining()).toBe(BigInt(50))
    expect(packed.slabs()).toBe(BigInt(1))
  })

  it('uploadPacked.finalize returns wrapped PinnedObjectRef array', async () => {
    const mockSdk = createMockSdk()
    const adapter = createNodeSdkAdapter(mockSdk as any)
    const packed = await adapter.uploadPacked({
      maxInflight: 10,
      dataShards: 10,
      parityShards: 3,
    })
    const objects = await packed.finalize()
    expect(objects).toHaveLength(1)
    expect(objects[0].id()).toBe('obj-1')
    expect(objects[0].metadata()).toBeInstanceOf(ArrayBuffer)
  })

  it('hosts maps protocol strings to AddressProtocol enum', async () => {
    const mockSdk = createMockSdk()
    const adapter = createNodeSdkAdapter(mockSdk as any)
    const hosts = await adapter.hosts()
    expect(hosts).toHaveLength(1)
    expect(hosts[0].publicKey).toBe('host-pk-1')
    expect(hosts[0].addresses[0].protocol).toBe(AddressProtocol.SiaMux)
    expect(hosts[0].addresses[1].protocol).toBe(AddressProtocol.Quic)
  })

  it('account maps AccountInfo to Account (drops ready)', async () => {
    const mockSdk = createMockSdk()
    const adapter = createNodeSdkAdapter(mockSdk as any)
    const account = await adapter.account()
    expect(account.accountKey).toBe('acct-key-1')
    expect(account.maxPinnedData).toBe(BigInt(1_000_000_000))
    expect(account.app.id).toBe('app-1')
    expect(account.app.description).toBe('Test application')
    expect((account as any).ready).toBeUndefined()
  })

  it('downloadByObjectId concatenates chunks to single ArrayBuffer', async () => {
    const mockSdk = createMockSdk()
    const adapter = createNodeSdkAdapter(mockSdk as any)
    const data = await adapter.downloadByObjectId('obj-1')
    expect(data).toBeInstanceOf(ArrayBuffer)
    expect(Buffer.from(data).toString()).toBe('downloaded data')
  })

  it('getPinnedObject wraps result correctly', async () => {
    const mockSdk = createMockSdk()
    const adapter = createNodeSdkAdapter(mockSdk as any)
    const obj = await adapter.getPinnedObject('obj-1')
    expect(obj.id()).toBe('obj-1')
    expect(obj.size()).toBe(BigInt(1024))
    expect(obj.metadata()).toBeInstanceOf(ArrayBuffer)
  })

  it('PinnedObjectRef.seal() returns SealedObjectRef with ArrayBuffer fields', async () => {
    const mockSdk = createMockSdk()
    const adapter = createNodeSdkAdapter(mockSdk as any)
    const obj = await adapter.getPinnedObject('obj-1')
    const appKey = adapter.appKey()
    const sealed = obj.seal(appKey)
    expect(sealed.id).toBe('obj-1')
    expect(sealed.encryptedDataKey).toBeInstanceOf(ArrayBuffer)
    expect(sealed.encryptedMetadataKey).toBeInstanceOf(ArrayBuffer)
    expect(sealed.encryptedMetadata).toBeInstanceOf(ArrayBuffer)
    expect(sealed.dataSignature).toBeInstanceOf(ArrayBuffer)
    expect(sealed.metadataSignature).toBeInstanceOf(ArrayBuffer)
    expect(sealed.slabs[0].encryptionKey).toBeInstanceOf(ArrayBuffer)
  })

  it('PinnedObjectRef.slabs() returns ArrayBuffer encryptionKeys', async () => {
    const mockSdk = createMockSdk()
    const adapter = createNodeSdkAdapter(mockSdk as any)
    const obj = await adapter.getPinnedObject('obj-1')
    const slabs = obj.slabs()
    expect(slabs).toHaveLength(1)
    expect(slabs[0].encryptionKey).toBeInstanceOf(ArrayBuffer)
    expect(slabs[0].minShards).toBe(10)
    expect(slabs[0].sectors[0].root).toBe('abc')
  })
})
