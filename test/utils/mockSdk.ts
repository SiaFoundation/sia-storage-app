/**
 * In-memory mock SDK for core tests.
 *
 * Provides a mock SDK implementation with fake in-memory storage for:
 * - Objects and their metadata
 * - Event stream for sync
 * - Upload/download operations
 *
 * Note: This does not implement SdkInterface directly to avoid complex
 * type requirements. Instead, it provides the methods needed for testing
 * and is cast to `any` when passed to app code.
 */

import type {
  ObjectEvent,
  ObjectsCursor,
  PinnedObjectInterface,
} from 'react-native-sia'
import {
  decodeFileMetadata,
  encodeFileMetadata,
} from '../../src/encoding/fileMetadata'
import type { FileMetadata } from '../../src/stores/files'

export type StoredObject = {
  id: string
  metadata: ArrayBuffer
  size: bigint
  slabs: Array<{ id: string; data: Uint8Array }>
  createdAt: Date
  updatedAt: Date
}

export interface MockSdkStorage {
  objects: Map<string, StoredObject>
  events: ObjectEvent[]
  eventCursor: number
  fileData: Map<string, Uint8Array>
  uploadFailures: Map<string, Error>
}

function createEmptyStorage(): MockSdkStorage {
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

function createMockPinnedObject(stored: StoredObject): PinnedObjectInterface {
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
    seal: () => ({
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
  } as PinnedObjectInterface
}

export interface MockPackerInterface {
  add(reader: MockReader): Promise<bigint>
  remaining(): Promise<bigint>
  finalize(): Promise<PinnedObjectInterface[]>
}

export interface MockReader {
  read(dest: ArrayBuffer): Promise<bigint>
}

export interface MockWriter {
  write(data: ArrayBuffer): Promise<bigint>
}

export class MockPacker implements MockPackerInterface {
  private storage: MockSdkStorage
  private options: {
    progressCallback?: { progress: (uploaded: bigint, total: bigint) => void }
  }
  private files: Array<{ data: Uint8Array; size: bigint }> = []
  private totalSize = 0n
  private slabSize = 120n * 1024n * 1024n // 120 MiB

  constructor(
    storage: MockSdkStorage,
    options: {
      progressCallback?: { progress: (uploaded: bigint, total: bigint) => void }
    },
  ) {
    this.storage = storage
    this.options = options
  }

  async add(reader: MockReader): Promise<bigint> {
    const chunks: Uint8Array[] = []
    let totalRead = 0n

    while (true) {
      const buffer = new ArrayBuffer(1024 * 1024) // 1MB chunks
      const bytesRead = await reader.read(buffer)
      if (bytesRead === 0n) break

      const chunk = new Uint8Array(buffer, 0, Number(bytesRead))
      chunks.push(new Uint8Array(chunk))
      totalRead += bytesRead
    }

    const fullData = new Uint8Array(
      chunks.reduce((acc, chunk) => acc + chunk.length, 0),
    )
    let offset = 0
    for (const chunk of chunks) {
      fullData.set(chunk, offset)
      offset += chunk.length
    }

    this.files.push({ data: fullData, size: totalRead })
    this.totalSize += totalRead

    // Don't send progress during add - progress is sent during finalize
    // which simulates the real SDK behavior where upload happens during finalize

    return totalRead
  }

  async remaining(): Promise<bigint> {
    const used = this.totalSize % this.slabSize
    return this.slabSize - used
  }

  /**
   * Helper to wait for a short duration (simulating network time).
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async finalize(): Promise<PinnedObjectInterface[]> {
    // Check if any upload failures are configured
    if (this.storage.uploadFailures.size > 0) {
      const entries = this.storage.uploadFailures.entries()
      const first = entries.next()
      if (!first.done) {
        this.files = []
        this.totalSize = 0n
        throw first.value[1]
      }
    }

    const results: PinnedObjectInterface[] = []
    const totalBytes = this.totalSize

    // Simulate incremental progress during upload to hosts
    // Send progress at 0%, 25%, 50%, 75%, and 100%
    const progressSteps = [0.0, 0.25, 0.5, 0.75, 1.0]
    const delayPerStep = 50 // 50ms per step = 250ms total upload time

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

      // NOTE: We don't push events for local uploads. In the real SDK, the local
      // device already knows about objects it uploads. Events are for syncing
      // with OTHER devices. Test helpers like injectObject/injectMetadataChange
      // push events to simulate changes from other devices.

      results.push(createMockPinnedObject(stored))
    }

    this.files = []
    this.totalSize = 0n

    return results
  }
}

/**
 * Mock SDK that provides the core functionality needed for testing.
 * This is not a full SdkInterface implementation - it only implements
 * the methods used by the app code we're testing.
 */
export class MockSdk {
  private storage: MockSdkStorage
  private connected = true

  constructor(storage?: MockSdkStorage) {
    this.storage = storage ?? createEmptyStorage()
  }

  setConnected(connected: boolean): void {
    this.connected = connected
  }

  isConnected(): boolean {
    return this.connected
  }

  appKey() {
    // Return a mock AppKeyInterface with all required methods
    const keyData = new ArrayBuffer(64) // Mock key data
    return {
      // export_() is used by setAppKeyForIndexer to serialize the key
      export_: () => keyData,
      // publicKey() returns the public key as a hex string
      publicKey: () => '0'.repeat(64),
      // sign() returns a mock signature
      sign: (_message: ArrayBuffer) => new ArrayBuffer(64),
      // verifySignature() always returns true in tests
      verifySignature: (_message: ArrayBuffer, _signature: ArrayBuffer) => true,
    }
  }

  async account() {
    if (!this.connected) throw new Error('Network unavailable')

    let totalPinned = 0n
    for (const obj of this.storage.objects.values()) {
      totalPinned += obj.size
    }

    return {
      accountKey: 'mock-account-key',
      maxPinnedData: 1024n * 1024n * 1024n * 100n,
      pinnedData: totalPinned,
      app: {
        id: 'mock-app-id',
        name: 'Test App',
        description: 'Test app for core tests',
        serviceUrl: 'https://test.local',
        callbackUrl: 'test://callback',
        logoUrl: '',
      },
      lastUsed: new Date(),
    }
  }

  async deleteObject(key: string): Promise<void> {
    if (!this.connected) throw new Error('Network unavailable')

    const obj = this.storage.objects.get(key)
    if (!obj) return

    this.storage.objects.delete(key)
    this.storage.fileData.delete(key)

    this.storage.events.push({
      id: key,
      deleted: true,
      updatedAt: new Date(),
      object: undefined,
    })
  }

  async download(w: MockWriter, object: PinnedObjectInterface): Promise<void> {
    if (!this.connected) throw new Error('Network unavailable')

    const objectId = object.id()
    const data = this.storage.fileData.get(objectId)
    if (!data) {
      throw new Error(`Object not found: ${objectId}`)
    }

    await w.write(data.buffer as ArrayBuffer)
  }

  async hosts() {
    if (!this.connected) throw new Error('Network unavailable')
    return []
  }

  async object(key: string): Promise<PinnedObjectInterface> {
    if (!this.connected) throw new Error('Network unavailable')

    const stored = this.storage.objects.get(key)
    if (!stored) {
      throw new Error(`Object not found: ${key}`)
    }

    return createMockPinnedObject(stored)
  }

  async objectEvents(
    cursor: ObjectsCursor | undefined,
    limit: number,
  ): Promise<ObjectEvent[]> {
    if (!this.connected) throw new Error('Network unavailable')

    let startIndex = 0

    if (cursor) {
      const cursorIndex = this.storage.events.findIndex(
        (e) =>
          e.id === cursor.id && e.updatedAt.getTime() <= cursor.after.getTime(),
      )
      if (cursorIndex >= 0) {
        startIndex = cursorIndex + 1
      }
    }

    return this.storage.events.slice(startIndex, startIndex + limit)
  }

  async pinObject(): Promise<void> {
    if (!this.connected) throw new Error('Network unavailable')
  }

  async pruneSlabs(): Promise<void> {
    if (!this.connected) throw new Error('Network unavailable')
  }

  shareObject(object: PinnedObjectInterface): string {
    return `share://${object.id()}`
  }

  async sharedObject(): Promise<PinnedObjectInterface> {
    if (!this.connected) throw new Error('Network unavailable')
    throw new Error('Not implemented in mock')
  }

  async slab(): Promise<unknown> {
    if (!this.connected) throw new Error('Network unavailable')
    throw new Error('Not implemented in mock')
  }

  async updateObjectMetadata(object: PinnedObjectInterface): Promise<void> {
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

  async upload(): Promise<PinnedObjectInterface> {
    if (!this.connected) throw new Error('Network unavailable')
    throw new Error('Use uploadPacked instead')
  }

  async uploadPacked(options: {
    maxInflight?: number
    dataShards?: number
    parityShards?: number
    progressCallback?: { progress: (uploaded: bigint, total: bigint) => void }
  }): Promise<MockPackerInterface> {
    if (!this.connected) throw new Error('Network unavailable')
    return new MockPacker(this.storage, options)
  }

  // Test helpers

  /**
   * Inject a metadata change event as if from another device.
   */
  injectMetadataChange(objectId: string, changes: Partial<FileMetadata>): void {
    const stored = this.storage.objects.get(objectId)
    if (!stored) {
      throw new Error(`Object not found: ${objectId}`)
    }

    const currentMetadata = decodeFileMetadata(stored.metadata)
    const newMetadata = {
      ...currentMetadata,
      ...changes,
      // Use provided updatedAt or default to now
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

  /**
   * Inject a new object as if synced from another device.
   */
  injectObject(object: {
    id?: string
    metadata: FileMetadata
    data?: Uint8Array
  }): StoredObject {
    const objectId = object.id ?? generateObjectId()
    const now = new Date()
    const data = object.data ?? new Uint8Array(object.metadata.size)

    const stored: StoredObject = {
      id: objectId,
      metadata: encodeFileMetadata(object.metadata),
      size: BigInt(object.metadata.size),
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

  /**
   * Inject a delete event as if from another device.
   */
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
      object: undefined,
    })
  }

  /**
   * Get all stored objects.
   */
  getStoredObjects(): StoredObject[] {
    return Array.from(this.storage.objects.values())
  }

  /**
   * Get all events in the stream.
   */
  getAllEvents(): ObjectEvent[] {
    return [...this.storage.events]
  }

  /**
   * Get the underlying storage for direct manipulation.
   */
  getStorage(): MockSdkStorage {
    return this.storage
  }

  /**
   * Clear all stored data.
   */
  reset(): void {
    this.storage.objects.clear()
    this.storage.events = []
    this.storage.eventCursor = 0
    this.storage.fileData.clear()
    this.storage.uploadFailures.clear()
    objectIdCounter = 0
  }

  /**
   * Configure the SDK to fail uploads for a specific file ID.
   * When finalize() is called, if any file in the batch matches a
   * configured failure, the entire batch will fail with that error.
   */
  setUploadFailure(fileId: string, error: Error): void {
    this.storage.uploadFailures.set(fileId, error)
  }

  /**
   * Clear a previously configured upload failure.
   */
  clearUploadFailure(fileId: string): void {
    this.storage.uploadFailures.delete(fileId)
  }

  /**
   * Check if any upload failures are configured.
   */
  hasUploadFailures(): boolean {
    return this.storage.uploadFailures.size > 0
  }

  /**
   * Get the first configured upload failure error (if any).
   */
  getFirstUploadFailure(): Error | undefined {
    const entries = this.storage.uploadFailures.entries()
    const first = entries.next()
    if (first.done) return undefined
    return first.value[1]
  }
}

/**
 * Generate mock file metadata.
 */
export function generateMockFileMetadata(
  index: number,
  overrides: Partial<FileMetadata> = {},
): FileMetadata {
  const now = Date.now()
  return {
    name: `test-file-${index}.jpg`,
    type: 'image/jpeg',
    size: 1024 * (index + 1),
    hash: `hash-${index}`,
    createdAt: now - index * 1000,
    updatedAt: now - index * 1000,
    ...overrides,
  }
}

/**
 * Generate mock image data.
 */
export function generateMockImageData(size: number = 1024): Uint8Array {
  const data = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    data[i] = i % 256
  }
  return data
}
