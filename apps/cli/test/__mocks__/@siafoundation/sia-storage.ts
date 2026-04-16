// Runtime stubs for `@siafoundation/sia-storage`. Used by jest via
// moduleNameMapper to avoid loading the real NAPI/WASM bindings at test time.
// Types come from the real package's .d.ts (via tsconfig paths in jest.config.cjs);
// this file only needs to provide runtime values that don't crash.

export class AppKey {
  constructor(_seed: Buffer) {}
  publicKey() {
    return 'ed25519:mock'
  }
  sign(_msg: Buffer) {
    return Buffer.alloc(64)
  }
  verifySignature() {
    return true
  }
  export() {
    return Buffer.alloc(32)
  }
}

export class PinnedObject {
  constructor() {}
  static open() {
    return new PinnedObject()
  }
  id() {
    return 'mock-id'
  }
  size() {
    return BigInt(0)
  }
  encodedSize() {
    return BigInt(0)
  }
  metadata() {
    return Buffer.alloc(0)
  }
  updateMetadata() {}
  seal() {
    return {
      id: 'mock-id',
      encryptedDataKey: Buffer.alloc(32),
      encryptedMetadataKey: Buffer.alloc(32),
      slabs: [],
      encryptedMetadata: Buffer.alloc(0),
      dataSignature: Buffer.alloc(64),
      metadataSignature: Buffer.alloc(64),
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  }
  slabs() {
    return []
  }
  createdAt() {
    return new Date()
  }
  updatedAt() {
    return new Date()
  }
}

export class ObjectEvent {
  constructor(_native: unknown) {}
  get id() {
    return 'mock'
  }
  get deleted() {
    return false
  }
  get updatedAt() {
    return new Date()
  }
  get object(): PinnedObject | null {
    return null
  }
}

export class PackedUpload {
  constructor() {}
  remaining() {
    return BigInt(0)
  }
  length() {
    return BigInt(0)
  }
  slabs() {
    return BigInt(0)
  }
  async add(_stream: ReadableStream<Uint8Array>) {
    return BigInt(0)
  }
  async finalize(): Promise<PinnedObject[]> {
    return []
  }
  async cancel(): Promise<void> {}
}

export class Sdk {
  constructor() {}
  appKey() {
    return new AppKey(Buffer.alloc(32))
  }
  uploadPacked() {
    return new PackedUpload()
  }
  async upload() {
    return new PinnedObject()
  }
  download() {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close()
      },
    })
  }
  async hosts() {
    return []
  }
  async objectEvents() {
    return []
  }
  async updateObjectMetadata() {}
  async deleteObject() {}
  async object() {
    return new PinnedObject()
  }
  async slab() {
    return { id: '', encryptionKey: Buffer.alloc(32), minShards: 10, sectors: [] }
  }
  async pruneSlabs() {}
  async account() {
    return {
      accountKey: '',
      maxPinnedData: BigInt(0),
      remainingStorage: BigInt(0),
      pinnedData: BigInt(0),
      pinnedSize: BigInt(0),
      ready: true,
      app: { id: '', name: '', description: '' },
      lastUsed: new Date(),
    }
  }
  shareObject() {
    return ''
  }
  async sharedObject() {
    return new PinnedObject()
  }
  async pinObject() {}
}

export class Builder {
  #indexerUrl: string
  constructor(indexerUrl: string) {
    this.#indexerUrl = indexerUrl
  }
  async requestConnection() {}
  responseUrl() {
    return `${this.#indexerUrl}/approve?token=mock`
  }
  async waitForApproval() {}
  async connected(): Promise<Sdk | null> {
    return null
  }
  async register() {
    return new Sdk()
  }
}

export async function initSia() {}
export function generateRecoveryPhrase() {
  return 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
}
export function validateRecoveryPhrase() {}
export function setLogger() {}
export function encodedSize() {
  return BigInt(0)
}
