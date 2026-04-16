import {
  AddressProtocol,
  type Account,
  type AccountApp,
  type AppKeyRef,
  type DownloadLikeRef,
  type DownloadOptions,
  type Host,
  type ObjectEvent,
  type ObjectsCursor,
  type PackedUploadRef,
  type PinnedObjectRef,
  type Reader,
  type SdkAdapter,
  type SealedObjectRef,
  type ShardProgress,
  type UploadOptions,
} from '@siastorage/core/adapters'
import type { LocalObject } from '@siastorage/core/encoding/localObject'
import {
  AppKey,
  PinnedObject,
  type PackedUpload,
  type Sdk,
  type SealedObject,
  type ShardProgress as NativeShardProgress,
} from '@siafoundation/sia-storage'

// WeakMaps recover the native handle backing a wrapped ref. WeakMap means
// when the ref is GC'd, the entry clears automatically — no manual cleanup.
const nativePinnedObjects = new WeakMap<PinnedObjectRef, PinnedObject>()
const nativeAppKeys = new WeakMap<AppKeyRef, AppKey>()

function toArrayBuffer(buf: Uint8Array): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

function castShardProgress(p: NativeShardProgress): ShardProgress {
  return {
    hostKey: p.hostKey,
    shardSize: BigInt(p.shardSize),
    shardIndex: p.shardIndex,
    slabIndex: p.slabIndex,
    elapsedMs: BigInt(p.elapsedMs),
  }
}

function bridgeShardCallback(
  cb: { progress: (p: ShardProgress) => void } | undefined,
): ((p: NativeShardProgress) => void) | undefined {
  if (!cb) return undefined
  return (p) => cb.progress(castShardProgress(p))
}

function readerToReadableStream(reader: Reader): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async pull(controller) {
      const chunk = await reader.read()
      if (chunk.byteLength === 0) controller.close()
      else controller.enqueue(new Uint8Array(chunk))
    },
  })
}

function readableStreamToDownloadLikeRef(stream: ReadableStream<Uint8Array>): DownloadLikeRef {
  const reader = stream.getReader()
  return {
    async read(control) {
      if (control?.signal.aborted) {
        await reader.cancel().catch(() => {})
        throw new Error('Download aborted')
      }
      const { value, done } = await reader.read()
      if (done || !value) return new ArrayBuffer(0)
      return value.buffer.slice(
        value.byteOffset,
        value.byteOffset + value.byteLength,
      ) as ArrayBuffer
    },
    async cancel() {
      await reader.cancel().catch(() => {})
    },
  }
}

async function consumeStreamToBuffer(stream: ReadableStream<Uint8Array>): Promise<ArrayBuffer> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      chunks.push(value)
      total += value.byteLength
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  const combined = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    combined.set(c, offset)
    offset += c.byteLength
  }
  return combined.buffer.slice(0, total) as ArrayBuffer
}

function localObjectToSealedObject(object: LocalObject): SealedObject {
  return {
    id: object.id,
    encryptedDataKey: Buffer.from(new Uint8Array(object.encryptedDataKey)),
    encryptedMetadataKey: Buffer.from(new Uint8Array(object.encryptedMetadataKey)),
    slabs: object.slabs.map((s) => ({
      encryptionKey: Buffer.from(new Uint8Array(s.encryptionKey)),
      minShards: s.minShards,
      sectors: s.sectors,
      offset: s.offset,
      length: s.length,
    })),
    encryptedMetadata: Buffer.from(new Uint8Array(object.encryptedMetadata)),
    dataSignature: Buffer.from(new Uint8Array(object.dataSignature)),
    metadataSignature: Buffer.from(new Uint8Array(object.metadataSignature)),
    createdAt: object.createdAt,
    updatedAt: object.updatedAt,
  }
}

function requireNativeAppKey(ref: AppKeyRef, op: string): AppKey {
  const native = nativeAppKeys.get(ref)
  if (!native) throw new Error(`Cannot ${op}: AppKey was not created by this adapter`)
  return native
}

function requireNativePinnedObject(ref: PinnedObjectRef): PinnedObject {
  const native = nativePinnedObjects.get(ref)
  if (!native) throw new Error('PinnedObject was not created by this adapter')
  return native
}

function nativeProtocolToEnum(protocol: string): AddressProtocol {
  if (protocol === 'SiaMux') return AddressProtocol.SiaMux
  if (protocol === 'Quic') return AddressProtocol.Quic
  throw new Error(`Unknown AddressProtocol: ${protocol}`)
}

function wrapAppKey(key: AppKey): AppKeyRef {
  const ref: AppKeyRef = {
    export_() {
      return toArrayBuffer(key.export())
    },
    publicKey() {
      return key.publicKey()
    },
    sign(message: ArrayBuffer) {
      return toArrayBuffer(key.sign(Buffer.from(message)))
    },
    verifySignature(message: ArrayBuffer, signature: ArrayBuffer) {
      return key.verifySignature(Buffer.from(message), Buffer.from(signature))
    },
  }
  nativeAppKeys.set(ref, key)
  return ref
}

function wrapPinnedObject(obj: PinnedObject): PinnedObjectRef {
  const ref: PinnedObjectRef = {
    id() {
      return obj.id()
    },
    metadata() {
      return toArrayBuffer(obj.metadata())
    },
    updateMetadata(metadata: ArrayBuffer) {
      obj.updateMetadata(Buffer.from(metadata))
    },
    size() {
      return obj.size()
    },
    encodedSize() {
      return obj.encodedSize()
    },
    seal(appKey: AppKeyRef): SealedObjectRef {
      const nativeKey = requireNativeAppKey(appKey, 'seal')
      const sealed = obj.seal(nativeKey)
      return {
        id: sealed.id,
        encryptedDataKey: toArrayBuffer(sealed.encryptedDataKey),
        encryptedMetadataKey: toArrayBuffer(sealed.encryptedMetadataKey),
        slabs: sealed.slabs.map((s) => ({
          encryptionKey: toArrayBuffer(s.encryptionKey),
          minShards: s.minShards,
          sectors: s.sectors,
          offset: s.offset,
          length: s.length,
        })),
        encryptedMetadata: toArrayBuffer(sealed.encryptedMetadata),
        dataSignature: toArrayBuffer(sealed.dataSignature),
        metadataSignature: toArrayBuffer(sealed.metadataSignature),
        createdAt: sealed.createdAt,
        updatedAt: sealed.updatedAt,
      }
    },
    slabs() {
      return obj.slabs().map((s) => ({
        encryptionKey: toArrayBuffer(s.encryptionKey),
        minShards: s.minShards,
        sectors: s.sectors,
        offset: s.offset,
        length: s.length,
      }))
    },
    createdAt() {
      return obj.createdAt()
    },
    updatedAt() {
      return obj.updatedAt()
    },
  }
  nativePinnedObjects.set(ref, obj)
  return ref
}

function wrapPackedUpload(packed: PackedUpload): PackedUploadRef {
  return {
    async add(reader: Reader): Promise<bigint> {
      return packed.add(readerToReadableStream(reader))
    },
    async cancel(): Promise<void> {
      await packed.cancel()
    },
    async finalize(): Promise<PinnedObjectRef[]> {
      const objects = await packed.finalize()
      return objects.map(wrapPinnedObject)
    },
    length() {
      return packed.length()
    },
    remaining() {
      return packed.remaining()
    },
    slabs() {
      return packed.slabs()
    },
  }
}

export function createNodeSdkAdapter(sdk: Sdk): SdkAdapter {
  return {
    async objectEvents(cursor: ObjectsCursor | undefined, limit: number): Promise<ObjectEvent[]> {
      const events = await sdk.objectEvents(cursor, limit)
      return events.map((e) => ({
        id: e.id,
        deleted: e.deleted || undefined,
        updatedAt: e.updatedAt,
        object: e.object ? wrapPinnedObject(e.object) : undefined,
      }))
    },

    async updateObjectMetadata(pinnedObject: PinnedObjectRef): Promise<void> {
      await sdk.updateObjectMetadata(requireNativePinnedObject(pinnedObject))
    },

    async download(
      pinnedObject: PinnedObjectRef,
      options: DownloadOptions,
    ): Promise<DownloadLikeRef> {
      const native = requireNativePinnedObject(pinnedObject)
      const stream = sdk.download(native, {
        maxInflight: options.maxInflight,
        offset: options.offset,
        length: options.length,
        onShardDownloaded: bridgeShardCallback(options.shardDownloaded),
      })
      return readableStreamToDownloadLikeRef(stream)
    },

    async uploadPacked(options: UploadOptions): Promise<PackedUploadRef> {
      const packed = sdk.uploadPacked({
        maxInflight: options.maxInflight,
        dataShards: options.dataShards,
        parityShards: options.parityShards,
        onShardUploaded: bridgeShardCallback(options.shardUploaded),
      })
      return wrapPackedUpload(packed)
    },

    async pinObject(pinnedObject: PinnedObjectRef): Promise<void> {
      await sdk.pinObject(requireNativePinnedObject(pinnedObject))
    },

    async deleteObject(objectId: string): Promise<void> {
      await sdk.deleteObject(objectId)
    },

    async getPinnedObject(objectId: string): Promise<PinnedObjectRef> {
      const obj = await sdk.object(objectId)
      return wrapPinnedObject(obj)
    },

    async sharedObject(url: string): Promise<PinnedObjectRef> {
      const obj = await sdk.sharedObject(url)
      return wrapPinnedObject(obj)
    },

    shareObject(object: PinnedObjectRef, validUntil: Date): string {
      return sdk.shareObject(requireNativePinnedObject(object), validUntil)
    },

    openAppKey(bytes: Uint8Array): AppKeyRef {
      return wrapAppKey(new AppKey(Buffer.from(bytes)))
    },

    openPinnedObject(appKey: AppKeyRef, object: LocalObject): PinnedObjectRef {
      const nativeKey = requireNativeAppKey(appKey, 'openPinnedObject')
      const sealed = localObjectToSealedObject(object)
      return wrapPinnedObject(PinnedObject.open(nativeKey, sealed))
    },

    appKey(): AppKeyRef {
      return wrapAppKey(sdk.appKey())
    },

    /**
     * Returns the entire object as an ArrayBuffer. Defeats streaming —
     * only use for small objects (e.g., share-URL metadata fetches).
     */
    async downloadByObjectId(objectId: string): Promise<ArrayBuffer> {
      const obj = await sdk.object(objectId)
      const stream = sdk.download(obj, { maxInflight: 1, offset: BigInt(0), length: undefined })
      return consumeStreamToBuffer(stream)
    },

    async hosts(): Promise<Host[]> {
      const hosts = await sdk.hosts()
      return hosts.map((h) => ({
        publicKey: h.publicKey,
        addresses: h.addresses.map((a) => ({
          protocol: nativeProtocolToEnum(a.protocol),
          address: a.address,
        })),
        countryCode: h.countryCode,
        latitude: h.latitude,
        longitude: h.longitude,
        goodForUpload: h.goodForUpload,
      }))
    },

    async account(): Promise<Account> {
      const info = await sdk.account()
      const app: AccountApp = {
        id: info.app.id,
        description: info.app.description,
        serviceUrl: info.app.serviceUrl,
        logoUrl: info.app.logoUrl,
      }
      return {
        accountKey: info.accountKey,
        maxPinnedData: info.maxPinnedData,
        remainingStorage: info.remainingStorage,
        pinnedData: info.pinnedData,
        pinnedSize: info.pinnedSize,
        app,
        lastUsed: info.lastUsed,
      }
    },
  }
}
