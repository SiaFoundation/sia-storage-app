import type { LocalObject } from '../encoding/localObject'
import type { Reader } from './fs'

export interface ObjectsCursor {
  id: string
  after: Date
}

export interface AppKeyRef {
  export_(): ArrayBuffer
  publicKey(): string
  sign(message: ArrayBuffer): ArrayBuffer
  verifySignature(message: ArrayBuffer, signature: ArrayBuffer): boolean
}

export interface SealedObjectRef {
  id: string
  encryptedDataKey: ArrayBuffer
  encryptedMetadataKey: ArrayBuffer
  slabs: Array<{
    encryptionKey: ArrayBuffer
    minShards: number
    sectors: Array<{ root: string; hostKey: string }>
    offset: number
    length: number
  }>
  encryptedMetadata: ArrayBuffer
  dataSignature: ArrayBuffer
  metadataSignature: ArrayBuffer
  createdAt: Date
  updatedAt: Date
}

export interface PinnedObjectRef {
  id(): string
  metadata(): ArrayBuffer
  updateMetadata(metadata: ArrayBuffer): void
  size(): bigint
  encodedSize(): bigint
  seal(appKey: AppKeyRef): SealedObjectRef
  slabs(): Array<{
    encryptionKey: ArrayBuffer
    minShards: number
    sectors: Array<{ root: string; hostKey: string }>
    offset: number
    length: number
  }>
  createdAt(): Date
  updatedAt(): Date
}

export interface PackedUploadRef {
  add(reader: Reader): Promise<bigint>
  cancel(): Promise<void>
  finalize(): Promise<PinnedObjectRef[]>
  length(): bigint
  remaining(): bigint
  slabs(): bigint
}

/**
 * Progress information emitted by the SDK for each successfully uploaded
 * or downloaded shard. Matches the shape of `react-native-sia`'s
 * `ShardProgress` record.
 */
export interface ShardProgress {
  hostKey: string
  shardSize: bigint
  shardIndex: number
  slabIndex: number
  elapsedMs: bigint
}

export interface UploadOptions {
  maxInflight: number
  dataShards: number
  parityShards: number
  shardUploaded?: {
    progress: (p: ShardProgress) => void
  }
}

export interface DownloadOptions {
  maxInflight: number
  offset: bigint
  length: bigint | undefined
}

export interface ObjectEvent {
  id: string
  object?: PinnedObjectRef
  deleted?: boolean
  updatedAt: Date
}

export enum AddressProtocol {
  SiaMux = 0,
  Quic = 1,
}

export interface NetAddress {
  protocol: AddressProtocol
  address: string
}

export interface Host {
  publicKey: string
  addresses: NetAddress[]
  countryCode: string
  latitude: number
  longitude: number
  goodForUpload: boolean
}

export interface AccountApp {
  id: string
  description: string
  serviceUrl?: string
  logoUrl?: string
}

export interface Account {
  accountKey: string
  maxPinnedData: bigint
  remainingStorage: bigint
  pinnedData: bigint
  pinnedSize: bigint
  app: AccountApp
  lastUsed: Date
}

/**
 * Pull-based download handle. Call `read()` repeatedly to receive decoded
 * chunks; an empty ArrayBuffer signals end of stream. Call `cancel()` to
 * abort in-flight chunk recovery (subsequent reads resolve with an empty
 * buffer or throw `DownloadError::Cancelled`). Matches the shape of
 * uniffi-generated `DownloadLike` across platforms.
 */
export interface DownloadLikeRef {
  /**
   * Resolves to the next decoded chunk, or an empty `ArrayBuffer` on
   * end of stream. Also resolves with an empty buffer (or rejects with
   * `DownloadError::Cancelled`) once `cancel()` has been called.
   * Callers loop until `byteLength === 0` or an exception propagates.
   */
  read(control?: { signal: AbortSignal }): Promise<ArrayBuffer>
  cancel(): Promise<void>
}

export interface SdkAdapter {
  objectEvents(cursor: ObjectsCursor | undefined, limit: number): Promise<ObjectEvent[]>
  updateObjectMetadata(pinnedObject: PinnedObjectRef): Promise<void>
  download(pinnedObject: PinnedObjectRef, options: DownloadOptions): Promise<DownloadLikeRef>
  uploadPacked(options: UploadOptions): Promise<PackedUploadRef>
  pinObject(pinnedObject: PinnedObjectRef): Promise<void>
  deleteObject(objectId: string): Promise<void>
  getPinnedObject(objectId: string): Promise<PinnedObjectRef>
  sharedObject(url: string): Promise<PinnedObjectRef>
  shareObject(object: PinnedObjectRef, validUntil: Date): string
  /** Reconstructs a live AppKeyRef from stored key bytes. */
  openAppKey(bytes: Uint8Array): AppKeyRef
  /** Reconstructs a live PinnedObjectRef from a stored LocalObject. */
  openPinnedObject(appKey: AppKeyRef, object: LocalObject): PinnedObjectRef
  appKey(): AppKeyRef
  downloadByObjectId(objectId: string): Promise<ArrayBuffer>
  hosts(): Promise<Host[]>
  account(): Promise<Account>
}
