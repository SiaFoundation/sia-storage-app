import type { LocalObject } from '../encoding/localObject'
import type { Slab } from '../types/slabs'

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
  slabs: Array<Slab>
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
  slabs(): Array<Slab>
  createdAt(): Date
  updatedAt(): Date
}

export interface PackedUploadRef {
  /** The SDK opens and reads the file, so no data crosses FFI per chunk. */
  addPath(path: string): Promise<bigint>
  cancel(): void
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
  dataShards: number
  parityShards: number
  shardUploaded?: {
    progress: (p: ShardProgress) => void
  }
}

export interface DownloadOptions {
  offset: bigint
  length: bigint | undefined
  shardDownloaded?: {
    progress: (p: ShardProgress) => void
  }
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

/**
 * A sharing key as plain data. Anyone holding the seed can read the objects
 * attached to the key, at the account's expense, so it is a credential.
 * Adapters rebuild their native key from the seed on each call.
 */
export interface SharingKeyRef {
  publicKey: string
  /** 32 bytes. A share link carries it hex encoded. */
  seed: Uint8Array
}

/** A sharing key as the indexer lists it for the account that made it. */
export interface SharingKeyRecord {
  key: SharingKeyRef
  description: string
  /** Absent for a key that never expires. The indexer stops listing a key once it expires. */
  expiresAt?: Date
  createdAt: Date
  objectCount: number
}

export interface SdkAdapter {
  objectEvents(cursor: ObjectsCursor | undefined, limit: number): Promise<ObjectEvent[]>
  updateObjectMetadata(pinnedObject: PinnedObjectRef): Promise<void>
  download(pinnedObject: PinnedObjectRef, options: DownloadOptions): Promise<DownloadLikeRef>
  uploadPacked(options: UploadOptions): Promise<PackedUploadRef>
  pinObject(pinnedObject: PinnedObjectRef): Promise<void>
  deleteObject(objectId: string): Promise<void>
  getPinnedObject(objectId: string): Promise<PinnedObjectRef>
  /** Opens an object from a signed per-object URL that `objectShareUrl` made. */
  objectFromShareUrl(url: string): Promise<PinnedObjectRef>
  /** A signed URL for one object, valid until `validUntil`, which the recipient opens with their own account. */
  objectShareUrl(object: PinnedObjectRef, validUntil: Date): string
  /**
   * Creates a sharing key on the indexer. The SDK derives it from the app key
   * and a random nonce the indexer keeps, so `sharingKeys` returns the same
   * key, seed included, on any device signed in to the account.
   */
  createSharingKey(description: string, expiresAt?: Date): Promise<SharingKeyRef>
  /** The account's live sharing keys, newest first. Expired and revoked keys are not listed. */
  sharingKeys(offset: number, limit: number): Promise<SharingKeyRecord[]>
  /**
   * Attaches an object to a key with the metadata the handle holds at the
   * time. Recipients keep seeing that metadata until it is attached again,
   * which replaces the earlier attachment.
   */
  shareObject(key: SharingKeyRef, object: PinnedObjectRef): Promise<void>
  /** The objects attached to a key, newest attachment first. */
  sharedObjects(key: SharingKeyRef, offset: number, limit: number): Promise<PinnedObjectRef[]>
  unshareObject(key: SharingKeyRef, objectId: string): Promise<void>
  /** Deletes the key and detaches everything attached to it. */
  revokeSharingKey(key: SharingKeyRef): Promise<void>
  /** Reconstructs a live AppKeyRef from stored key bytes. */
  openAppKey(bytes: Uint8Array): AppKeyRef
  /** Reconstructs a live PinnedObjectRef from a stored LocalObject. */
  openPinnedObject(appKey: AppKeyRef, object: LocalObject): PinnedObjectRef
  appKey(): AppKeyRef
  downloadByObjectId(objectId: string): Promise<ArrayBuffer>
  hosts(): Promise<Host[]>
  account(): Promise<Account>
  /**
   * Unpins slabs no longer referenced by any object on the account,
   * reclaiming the storage held by deleted objects. Blocks on a single
   * indexer round-trip and resolves with no data on success.
   */
  pruneSlabs(): Promise<void>
}
