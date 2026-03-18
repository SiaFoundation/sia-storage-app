import type {
  Account,
  AppKeyRef,
  DownloadOptions,
  Host,
  ObjectEvent,
  ObjectsCursor,
  PackedUploadRef,
  PinnedObjectRef,
  Reader,
  SdkAdapter,
  SealedObjectRef,
  UploadOptions,
  Writer,
} from '@siastorage/core/adapters'
import {
  decodeFileMetadata,
  encodeFileMetadata,
} from '@siastorage/core/encoding/fileMetadata'
import type { FileMetadata } from '@siastorage/core/types'

export type StoredObject = {
  id: string
  metadata: ArrayBuffer
  size: bigint
  slabs: Array<{ id: string; data: Uint8Array }>
  createdAt: Date
  updatedAt: Date
}

export interface MockIndexerStorage {
  objects: Map<string, StoredObject>
  events: ObjectEvent[]
  eventCursor: number
  fileData: Map<string, Uint8Array>
  uploadFailures: Map<string, Error>
}

export function createEmptyIndexerStorage(): MockIndexerStorage {
  return {
    objects: new Map(),
    events: [],
    eventCursor: 0,
    fileData: new Map(),
    uploadFailures: new Map(),
  }
}

let objectIdCounter = 0

function generateObjectId(): string {
  objectIdCounter++
  return `mock-obj-${objectIdCounter}`
}

export function resetObjectIdCounter(): void {
  objectIdCounter = 0
}

function createMockPinnedObject(stored: StoredObject): PinnedObjectRef {
  let currentMetadata = stored.metadata

  return {
    id: () => stored.id,
    metadata: () => currentMetadata,
    size: () => stored.size,
    slabs: () => [],
    createdAt: () => stored.createdAt,
    updatedAt: () => stored.updatedAt,
    updateMetadata: (newMetadata: ArrayBuffer) => {
      currentMetadata = newMetadata
      stored.metadata = newMetadata
      stored.updatedAt = new Date()
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
  private options: {
    progressCallback?: { progress: (uploaded: bigint, total: bigint) => void }
  }
  private files: Array<{ data: Uint8Array; size: bigint }> = []
  private totalSize = 0n
  private slabSize = 120n * 1024n * 1024n

  constructor(
    storage: MockIndexerStorage,
    options: {
      progressCallback?: { progress: (uploaded: bigint, total: bigint) => void }
    },
  ) {
    this.storage = storage
    this.options = options
  }

  async add(reader: Reader): Promise<bigint> {
    const data = await reader.read()
    const bytes = new Uint8Array(data)
    const size = BigInt(bytes.length)
    this.files.push({ data: bytes, size })
    this.totalSize += size
    return size
  }

  async cancel(): Promise<void> {
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

    const progressSteps = [0.0, 0.25, 0.5, 0.75, 1.0]
    const delayPerStep = 50

    for (const progress of progressSteps) {
      if (this.options.progressCallback && totalBytes > 0n) {
        const uploaded = BigInt(Math.floor(Number(totalBytes) * progress))
        this.options.progressCallback.progress(uploaded, totalBytes)
      }
      if (progress < 1.0) {
        await this.sleep(delayPerStep)
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
  private connected = true

  constructor(storage?: MockIndexerStorage) {
    this.storage = storage ?? createEmptyIndexerStorage()
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

    this.storage.events.push({
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
    _writer: Writer,
    _pinnedObject: PinnedObjectRef,
    _options: DownloadOptions,
    _control?: { signal: AbortSignal },
  ): Promise<void> {
    throw new Error('Not implemented in mock')
  }

  async downloadByObjectId(objectId: string): Promise<ArrayBuffer> {
    if (!this.connected) throw new Error('Network unavailable')
    const data = this.storage.fileData.get(objectId)
    if (!data) throw new Error(`No data for object: ${objectId}`)
    return data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer
  }

  async objectEvents(
    cursor: ObjectsCursor | undefined,
    limit: number,
  ): Promise<ObjectEvent[]> {
    if (!this.connected) throw new Error('Network unavailable')

    let startIndex = 0

    if (cursor) {
      let cursorIndex = -1
      for (let i = this.storage.events.length - 1; i >= 0; i--) {
        const e = this.storage.events[i]
        if (
          e.id === cursor.id &&
          e.updatedAt.getTime() <= cursor.after.getTime()
        ) {
          cursorIndex = i
          break
        }
      }
      if (cursorIndex >= 0) {
        startIndex = cursorIndex + 1
      }
    }

    return this.storage.events.slice(startIndex, startIndex + limit)
  }

  async pinObject(object: PinnedObjectRef): Promise<void> {
    if (!this.connected) throw new Error('Network unavailable')

    const objectId = object.id()
    const stored = this.storage.objects.get(objectId)
    if (!stored) return

    this.storage.events.push({
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

    this.storage.events.push({
      id: objectId,
      deleted: false,
      updatedAt: stored.updatedAt,
      object: createMockPinnedObject(stored),
    })
  }

  async uploadPacked(options: UploadOptions): Promise<PackedUploadRef> {
    if (!this.connected) throw new Error('Network unavailable')
    return new MockPacker(this.storage, options)
  }

  async sharedObject(_url: string): Promise<PinnedObjectRef> {
    if (!this.connected) throw new Error('Network unavailable')
    throw new Error('Not implemented in mock')
  }

  shareObject(_object: PinnedObjectRef, _validUntil: Date): string {
    return 'https://mock-share-url.com'
  }

  async hosts(): Promise<Host[]> {
    return []
  }

  async account(): Promise<Account> {
    return {
      accountKey: '0'.repeat(64),
      maxPinnedData: 1000000000n,
      pinnedData: 0n,
      pinnedSize: 0n,
      app: {
        id: 'mock-app',
        description: 'Mock App',
      },
      lastUsed: new Date(),
    }
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

    this.storage.events.push({
      id: objectId,
      deleted: false,
      updatedAt: stored.updatedAt,
      object: createMockPinnedObject(stored),
    })
  }

  injectObject(object: {
    id?: string
    metadata: FileMetadata
    data?: Uint8Array
  }): StoredObject {
    const objectId = object.id ?? generateObjectId()
    const now = new Date()
    const metadata = object.metadata
    const data = object.data ?? new Uint8Array(metadata.size)

    const stored: StoredObject = {
      id: objectId,
      metadata: encodeFileMetadata(metadata),
      size: BigInt(metadata.size),
      slabs: [{ id: `slab-${objectId}`, data }],
      createdAt: now,
      updatedAt: now,
    }

    this.storage.objects.set(objectId, stored)
    this.storage.fileData.set(objectId, data)

    this.storage.events.push({
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
    }

    this.storage.events.push({
      id: objectId,
      deleted: true,
      updatedAt: new Date(),
    })
  }

  getStoredObjects(): StoredObject[] {
    return Array.from(this.storage.objects.values())
  }

  getAllEvents(): ObjectEvent[] {
    return [...this.storage.events]
  }

  getStorage(): MockIndexerStorage {
    return this.storage
  }

  reset(): void {
    this.storage.objects.clear()
    this.storage.events = []
    this.storage.eventCursor = 0
    this.storage.fileData.clear()
    this.storage.uploadFailures.clear()
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
    hash: `hash-${index}`,
    createdAt: now - index * 1000,
    updatedAt: now - index * 1000,
    trashedAt: null,
    ...overrides,
  }
}
