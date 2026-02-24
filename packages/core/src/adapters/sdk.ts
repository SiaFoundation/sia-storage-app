import type { Reader, Writer } from './fs'

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
  slabs: Array<{ encryptionKey: ArrayBuffer; minShards: number; sectors: Array<{ root: string; hostKey: string }>; offset: number; length: number }>
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
  seal(appKey: AppKeyRef): SealedObjectRef
  slabs(): Array<{ encryptionKey: ArrayBuffer; minShards: number; sectors: Array<{ root: string; hostKey: string }>; offset: number; length: number }>
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

export interface UploadOptions {
  maxInflight: number
  dataShards: number
  parityShards: number
  progressCallback?: {
    progress: (uploaded: bigint, total: bigint) => void
  }
}

export interface DownloadOptions {
  maxInflight: number
  offset: bigint
  length?: bigint
}

export interface ObjectEvent {
  id: string
  object?: PinnedObjectRef
  deleted?: boolean
  updatedAt: Date
}

export interface SdkAdapter {
  objectEvents(
    cursor: ObjectsCursor | undefined,
    limit: number,
  ): Promise<ObjectEvent[]>
  updateObjectMetadata(pinnedObject: PinnedObjectRef): Promise<void>
  download(
    writer: Writer,
    pinnedObject: PinnedObjectRef,
    options: DownloadOptions,
    control?: { signal: AbortSignal },
  ): Promise<void>
  uploadPacked(options: UploadOptions): Promise<PackedUploadRef>
  pinObject(pinnedObject: PinnedObjectRef): Promise<void>
  sharedObject(url: string): Promise<PinnedObjectRef>
  appKey(): AppKeyRef
}
