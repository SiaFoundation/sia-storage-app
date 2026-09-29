import type {
  Account,
  AppKeyRef,
  DownloadLikeRef,
  DownloadOptions,
  Host,
  ObjectEvent,
  ObjectsCursor,
  PackedUploadRef,
  PinnedObjectRef,
  SdkAdapter,
  SealedObjectRef,
  SharingKeyRecord,
  SharingKeyRef,
  UploadOptions,
} from '@siastorage/core/adapters'
import { SECTOR_SIZE } from '@siastorage/core/config'
import { toContentHash } from '@siastorage/core/lib/contentHash'
import { decodeFileMetadata, encodeFileMetadata } from '@siastorage/core/encoding/fileMetadata'
import type { LocalObject } from '@siastorage/core/encoding/localObject'
import type { FileMetadata } from '@siastorage/core/types'

/**
 * The real SDK opens the file itself, so the mock needs its own way to bytes.
 * Defaults to the real filesystem so integration tests keep exercising real
 * files; unit tests with synthetic URIs inject a stub.
 */
export type MockFileReader = (path: string) => Promise<Uint8Array>

const readFromDisk: MockFileReader = async (path) => {
  const { readFile } = await import('node:fs/promises')
  return new Uint8Array(await readFile(path))
}

export type StoredObject = {
  id: string
  metadata: ArrayBuffer
  size: bigint
  slabs: Array<{ id: string; data: Uint8Array }>
  createdAt: Date
  updatedAt: Date
}

/**
 * A sharing key as the indexer keeps it. The real indexer stores a nonce the
 * SDK derives the seed from, and this keeps the seed itself, which gives every
 * device of the account the same key back the same way.
 */
export type StoredSharingKey = {
  seed: Uint8Array
  description: string
  expiresAt?: Date
  createdAt: Date
  /** Each attached object's metadata as it was when attached, in attach order. */
  objects: Map<string, ArrayBuffer>
}

export interface MockIndexerStorage {
  objects: Map<string, StoredObject>
  events: ObjectEvent[]
  fileData: Map<string, Uint8Array>
  uploadFailures: Map<string, Error>
  sharingKeys: Map<string, StoredSharingKey>
  /** How many of the next packer adds fail, as an add does when it cannot read its file. */
  failingAdds: number
}

export function createEmptyIndexerStorage(): MockIndexerStorage {
  return {
    objects: new Map(),
    events: [],
    fileData: new Map(),
    uploadFailures: new Map(),
    sharingKeys: new Map(),
    failingAdds: 0,
  }
}

/** The public key the mock pairs with a seed. Not a real key derivation. */
export function mockSharingPublicKey(seed: Uint8Array): string {
  return `share-${Array.from(seed, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

let objectIdCounter = 0

function generateObjectId(): string {
  objectIdCounter++
  return `mock-obj-${objectIdCounter}`
}

export function resetObjectIdCounter(): void {
  objectIdCounter = 0
}

/**
 * A handle on a stored object. Editing its metadata changes the handle only,
 * as in the real SDK, and the store sees it on the next pin or metadata update.
 */
function createMockPinnedObject(
  stored: StoredObject,
  metadata: ArrayBuffer = stored.metadata,
): PinnedObjectRef {
  let currentMetadata = metadata

  return {
    id: () => stored.id,
    metadata: () => currentMetadata,
    size: () => stored.size,
    encodedSize: () => stored.size,
    slabs: () => [],
    createdAt: () => stored.createdAt,
    updatedAt: () => stored.updatedAt,
    updateMetadata: (newMetadata: ArrayBuffer) => {
      currentMetadata = newMetadata
    },
    seal: (_appKey: AppKeyRef): SealedObjectRef => ({
      id: stored.id,
      slabs: [],
      encryptedDataKey: new ArrayBuffer(32),
      encryptedMetadataKey: new ArrayBuffer(32),
      encryptedMetadata: currentMetadata,
      dataSignature: new ArrayBuffer(64),
      metadataSignature: new ArrayBuffer(64),
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
    }),
  }
}

class MockPacker implements PackedUploadRef {
  private storage: MockIndexerStorage
  private options: UploadOptions
  private files: Array<{ data: Uint8Array; size: bigint }> = []
  private readFile: MockFileReader
  private totalSize = 0n
  private slabSize = 120n * 1024n * 1024n
  private queue: Promise<unknown> = Promise.resolve()

  constructor(storage: MockIndexerStorage, options: UploadOptions, readFile: MockFileReader) {
    this.storage = storage
    this.options = options
    this.readFile = readFile
  }

  /**
   * Adds run one at a time in call order, as they do in the real SDK, so
   * finalize's objects come back in the order the adds were made.
   */
  addPath(path: string): Promise<bigint> {
    const run = this.queue.then(() => this.add(path))
    this.queue = run.catch(() => {})
    return run
  }

  private async add(path: string): Promise<bigint> {
    if (this.storage.failingAdds > 0) {
      this.storage.failingAdds--
      throw new Error(`could not read ${path}`)
    }
    const bytes = await this.readFile(path)
    const size = BigInt(bytes.length)
    this.files.push({ data: bytes, size })
    this.totalSize += size
    return size
  }

  cancel(): void {
    this.files = []
    this.totalSize = 0n
  }

  length(): bigint {
    return this.totalSize
  }

  remaining(): bigint {
    const used = this.totalSize % this.slabSize
    return this.slabSize - used
  }

  slabs(): bigint {
    return 0n
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async finalize(): Promise<PinnedObjectRef[]> {
    if (this.storage.uploadFailures.size > 0) {
      const first = this.storage.uploadFailures.entries().next()
      if (!first.done) {
        this.files = []
        this.totalSize = 0n
        throw first.value[1]
      }
    }

    const results: PinnedObjectRef[] = []
    const totalBytes = this.totalSize

    // Simulate per-shard progress: emit one event per (slab × shard)
    // with SECTOR_SIZE-sized shards, matching the real SDK's emission.
    // A batch of totalBytes spans ceil(totalBytes / slabBytes) slabs,
    // each containing (dataShards + parityShards) shards of SECTOR_SIZE.
    // Summing reported shardSize across all events equals the batch's
    // expectedEncoded = slabs × totalShards × SECTOR_SIZE, so consumers
    // computing progress from shard events reach exactly 1.0 at end.
    const dataShards = this.options.dataShards
    const parityShards = this.options.parityShards
    const totalShards = dataShards + parityShards
    const slabBytes = BigInt(SECTOR_SIZE) * BigInt(dataShards)
    const slabCount =
      totalBytes > 0n && slabBytes > 0n ? Number((totalBytes + slabBytes - 1n) / slabBytes) : 0
    const shardSize = BigInt(SECTOR_SIZE)
    const delayPerShard = 50

    for (let slab = 0; slab < slabCount; slab++) {
      for (let shard = 0; shard < totalShards; shard++) {
        if (this.options.shardUploaded) {
          this.options.shardUploaded.progress({
            hostKey: `mock-host-${slab}-${shard}`,
            shardSize,
            shardIndex: shard,
            slabIndex: slab,
            elapsedMs: BigInt(delayPerShard),
          })
        }
        const isLast = slab === slabCount - 1 && shard === totalShards - 1
        if (!isLast) {
          await this.sleep(delayPerShard)
        }
      }
    }

    for (const file of this.files) {
      const objectId = generateObjectId()
      const now = new Date()

      const stored: StoredObject = {
        id: objectId,
        metadata: new ArrayBuffer(0),
        size: file.size,
        slabs: [{ id: `slab-${objectId}`, data: file.data }],
        createdAt: now,
        updatedAt: now,
      }

      this.storage.objects.set(objectId, stored)
      this.storage.fileData.set(objectId, file.data)
      results.push(createMockPinnedObject(stored))
    }

    this.files = []
    this.totalSize = 0n

    return results
  }
}

export class MockSdk implements SdkAdapter {
  private storage: MockIndexerStorage
  private readFile: MockFileReader
  private connected = true
  pruneSlabsCallCount = 0

  constructor(storage?: MockIndexerStorage, readFile: MockFileReader = readFromDisk) {
    this.storage = storage ?? createEmptyIndexerStorage()
    this.readFile = readFile
  }

  private upsertEvent(event: ObjectEvent): void {
    const idx = this.storage.events.findIndex((e) => e.id === event.id)
    if (idx >= 0) {
      this.storage.events.splice(idx, 1)
    }
    this.storage.events.push(event)
  }

  setConnected(connected: boolean): void {
    this.connected = connected
  }

  isConnected(): boolean {
    return this.connected
  }

  appKey(): AppKeyRef {
    const keyData = new ArrayBuffer(64)
    return {
      export_: () => keyData,
      publicKey: () => '0'.repeat(64),
      sign: (_message: ArrayBuffer) => new ArrayBuffer(64),
      verifySignature: (_message: ArrayBuffer, _signature: ArrayBuffer) => true,
    }
  }

  async deleteObject(key: string): Promise<void> {
    if (!this.connected) throw new Error('Network unavailable')

    this.storage.objects.delete(key)
    this.storage.fileData.delete(key)
    // indexd detaches a deleted object from every sharing key.
    for (const sharingKey of this.storage.sharingKeys.values()) sharingKey.objects.delete(key)

    this.upsertEvent({
      id: key,
      deleted: true,
      updatedAt: new Date(),
    })
  }

  async getPinnedObject(key: string): Promise<PinnedObjectRef> {
    if (!this.connected) throw new Error('Network unavailable')

    const stored = this.storage.objects.get(key)
    if (!stored) {
      throw new Error(`Object not found: ${key}`)
    }

    return createMockPinnedObject(stored)
  }

  async download(
    _pinnedObject: PinnedObjectRef,
    _options: DownloadOptions,
  ): Promise<DownloadLikeRef> {
    throw new Error('Not implemented in mock')
  }

  async downloadByObjectId(objectId: string): Promise<ArrayBuffer> {
    if (!this.connected) throw new Error('Network unavailable')
    const data = this.storage.fileData.get(objectId)
    if (!data) throw new Error(`No data for object: ${objectId}`)
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  }

  async objectEvents(cursor: ObjectsCursor | undefined, limit: number): Promise<ObjectEvent[]> {
    if (!this.connected) throw new Error('Network unavailable')

    const sorted = [...this.storage.events].sort((a, b) => {
      const timeDiff = a.updatedAt.getTime() - b.updatedAt.getTime()
      if (timeDiff !== 0) return timeDiff
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })

    let filtered = sorted
    if (cursor) {
      const after = cursor.after.getTime()
      filtered = sorted.filter(
        (e) =>
          e.updatedAt.getTime() > after || (e.updatedAt.getTime() === after && e.id > cursor.id),
      )
    }

    return filtered.slice(0, limit)
  }

  async pinObject(object: PinnedObjectRef): Promise<void> {
    if (!this.connected) throw new Error('Network unavailable')

    const objectId = object.id()
    const stored = this.storage.objects.get(objectId)
    if (!stored) return
    stored.metadata = object.metadata()
    stored.updatedAt = new Date()

    this.upsertEvent({
      id: objectId,
      deleted: false,
      updatedAt: stored.updatedAt,
      object: createMockPinnedObject(stored),
    })
  }

  async updateObjectMetadata(object: PinnedObjectRef): Promise<void> {
    if (!this.connected) throw new Error('Network unavailable')

    const objectId = object.id()
    const stored = this.storage.objects.get(objectId)
    if (!stored) {
      throw new Error(`Object not found: ${objectId}`)
    }

    stored.metadata = object.metadata()
    stored.updatedAt = new Date()

    this.upsertEvent({
      id: objectId,
      deleted: false,
      updatedAt: stored.updatedAt,
      object: createMockPinnedObject(stored),
    })
  }

  async uploadPacked(options: UploadOptions): Promise<PackedUploadRef> {
    if (!this.connected) throw new Error('Network unavailable')
    return new MockPacker(this.storage, options, this.readFile)
  }

  async objectFromShareUrl(_url: string): Promise<PinnedObjectRef> {
    if (!this.connected) throw new Error('Network unavailable')
    throw new Error('Not implemented in mock')
  }

  objectShareUrl(_object: PinnedObjectRef, _validUntil: Date): string {
    return 'https://mock-share-url.com'
  }

  /** A live key, as indexd looks one up: missing, revoked and expired keys are all not found. */
  private liveSharingKey(key: SharingKeyRef): StoredSharingKey {
    const stored = this.storage.sharingKeys.get(key.publicKey)
    if (!stored || (stored.expiresAt && stored.expiresAt.getTime() <= Date.now())) {
      throw new Error('sharing key not found')
    }
    return stored
  }

  async createSharingKey(description: string, expiresAt?: Date): Promise<SharingKeyRef> {
    if (!this.connected) throw new Error('Network unavailable')
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new Error('expiration must be in the future')
    }
    const seed = crypto.getRandomValues(new Uint8Array(32))
    const publicKey = mockSharingPublicKey(seed)
    this.storage.sharingKeys.set(publicKey, {
      seed,
      description,
      expiresAt,
      createdAt: new Date(),
      objects: new Map(),
    })
    return { publicKey, seed }
  }

  async sharingKeys(offset: number, limit: number): Promise<SharingKeyRecord[]> {
    if (!this.connected) throw new Error('Network unavailable')
    const now = Date.now()
    return [...this.storage.sharingKeys.entries()]
      .filter(([, k]) => !k.expiresAt || k.expiresAt.getTime() > now)
      .reverse()
      .slice(offset, offset + limit)
      .map(([publicKey, k]) => ({
        key: { publicKey, seed: k.seed },
        description: k.description,
        expiresAt: k.expiresAt,
        createdAt: k.createdAt,
        objectCount: k.objects.size,
      }))
  }

  async shareObject(key: SharingKeyRef, object: PinnedObjectRef): Promise<void> {
    if (!this.connected) throw new Error('Network unavailable')
    const sharingKey = this.liveSharingKey(key)
    if (!this.storage.objects.has(object.id())) throw new Error('object not found')
    // Attaching again replaces the attachment and moves it to the newest.
    sharingKey.objects.delete(object.id())
    sharingKey.objects.set(object.id(), object.metadata())
  }

  async sharedObjects(
    key: SharingKeyRef,
    offset: number,
    limit: number,
  ): Promise<PinnedObjectRef[]> {
    if (!this.connected) throw new Error('Network unavailable')
    const sharingKey = this.liveSharingKey(key)
    return [...sharingKey.objects.entries()]
      .reverse()
      .slice(offset, offset + limit)
      .flatMap(([id, metadata]) => {
        const stored = this.storage.objects.get(id)
        return stored ? [createMockPinnedObject(stored, metadata)] : []
      })
  }

  async unshareObject(key: SharingKeyRef, objectId: string): Promise<void> {
    if (!this.connected) throw new Error('Network unavailable')
    this.liveSharingKey(key).objects.delete(objectId)
  }

  async revokeSharingKey(key: SharingKeyRef): Promise<void> {
    if (!this.connected) throw new Error('Network unavailable')
    this.liveSharingKey(key)
    this.storage.sharingKeys.delete(key.publicKey)
  }

  openAppKey(_bytes: Uint8Array): AppKeyRef {
    return this.appKey()
  }

  openPinnedObject(_appKey: AppKeyRef, object: LocalObject): PinnedObjectRef {
    const stored = this.storage.objects.get(object.id)
    if (!stored) throw new Error(`Object not found: ${object.id}`)
    return createMockPinnedObject(stored)
  }

  async hosts(): Promise<Host[]> {
    return []
  }

  async account(): Promise<Account> {
    return {
      accountKey: '0'.repeat(64),
      maxPinnedData: 1000000000n,
      remainingStorage: 1000000000n,
      pinnedData: 0n,
      pinnedSize: 0n,
      app: {
        id: 'mock-app',
        description: 'Mock App',
      },
      lastUsed: new Date(),
    }
  }

  async pruneSlabs(): Promise<void> {
    if (!this.connected) throw new Error('Network unavailable')
    this.pruneSlabsCallCount++
  }

  injectMetadataChange(objectId: string, changes: Partial<FileMetadata>): void {
    const stored = this.storage.objects.get(objectId)
    if (!stored) {
      throw new Error(`Object not found: ${objectId}`)
    }

    const currentMetadata = decodeFileMetadata(stored.metadata)
    const newMetadata = {
      ...currentMetadata,
      ...changes,
      updatedAt: changes.updatedAt ?? Date.now(),
    }
    stored.metadata = encodeFileMetadata(newMetadata)
    stored.updatedAt = new Date(newMetadata.updatedAt)

    this.upsertEvent({
      id: objectId,
      deleted: false,
      updatedAt: stored.updatedAt,
      object: createMockPinnedObject(stored),
    })
  }

  /** `omit` drops encoded fields, to publish metadata the way an older client wrote it. */
  injectObject(object: {
    id?: string
    metadata: FileMetadata
    data?: Uint8Array
    omit?: (keyof FileMetadata)[]
  }): StoredObject {
    const objectId = object.id ?? generateObjectId()
    const now = new Date()
    const metadata = object.metadata
    const data = object.data ?? new Uint8Array(metadata.size)
    let encoded = encodeFileMetadata(metadata)
    if (object.omit) {
      const payload = JSON.parse(new TextDecoder().decode(encoded))
      for (const key of object.omit) delete payload[key]
      encoded = new TextEncoder().encode(JSON.stringify(payload)).buffer as ArrayBuffer
    }

    const stored: StoredObject = {
      id: objectId,
      metadata: encoded,
      size: BigInt(metadata.size),
      slabs: [{ id: `slab-${objectId}`, data }],
      createdAt: now,
      updatedAt: now,
    }

    this.storage.objects.set(objectId, stored)
    this.storage.fileData.set(objectId, data)

    this.upsertEvent({
      id: objectId,
      deleted: false,
      updatedAt: now,
      object: createMockPinnedObject(stored),
    })

    return stored
  }

  injectDeleteEvent(objectId: string): void {
    const stored = this.storage.objects.get(objectId)
    if (stored) {
      this.storage.objects.delete(objectId)
      this.storage.fileData.delete(objectId)
      for (const sharingKey of this.storage.sharingKeys.values()) {
        sharingKey.objects.delete(objectId)
      }
    }

    this.upsertEvent({
      id: objectId,
      deleted: true,
      updatedAt: new Date(),
    })
  }

  getStoredObjects(): StoredObject[] {
    return Array.from(this.storage.objects.values())
  }

  getStorage(): MockIndexerStorage {
    return this.storage
  }

  reset(): void {
    this.storage.objects.clear()
    this.storage.events = []
    this.storage.fileData.clear()
    this.storage.uploadFailures.clear()
    this.storage.sharingKeys.clear()
    this.storage.failingAdds = 0
    objectIdCounter = 0
  }

  setUploadFailure(fileId: string, error: Error): void {
    this.storage.uploadFailures.set(fileId, error)
  }

  clearUploadFailure(fileId: string): void {
    this.storage.uploadFailures.delete(fileId)
  }
}

export function generateMockFileMetadata(
  index: number,
  overrides: Partial<FileMetadata> = {},
): FileMetadata {
  const now = Date.now()
  return {
    id: `mock-file-${index}`,
    name: `test-file-${index}.jpg`,
    type: 'image/jpeg',
    kind: 'file',
    size: 1024 * (index + 1),
    hash: toContentHash(index.toString(16).padStart(64, '0')),
    createdAt: now - index * 1000,
    updatedAt: now - index * 1000,
    trashedAt: null,
    ...overrides,
  }
}
