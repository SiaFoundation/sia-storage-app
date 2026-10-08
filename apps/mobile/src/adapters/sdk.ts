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
  SharingKeyRecord,
  SharingKeyRef,
  UploadOptions,
} from '@siastorage/core/adapters'
import type { LocalObject } from '@siastorage/core/encoding/localObject'
import {
  AppKey,
  type AppKeyInterface,
  PinnedObject,
  type PinnedObjectInterface,
  SharingKey,
  type SharingKeyInterface,
} from 'react-native-sia'
import type { SdkInterface } from 'react-native-sia'

/**
 * The SDK's own object behind a PinnedObjectRef. Every ref this adapter is
 * handed came out of the SDK, and the SDK's type carries methods the core's
 * narrower one leaves out.
 */
function native(object: PinnedObjectRef): PinnedObjectInterface {
  return object as PinnedObjectInterface
}

function sharingKeyRef(key: SharingKeyInterface): SharingKeyRef {
  return { publicKey: key.publicKey(), seed: new Uint8Array(key.seed()) }
}

function nativeSharingKey(key: SharingKeyRef): SharingKeyInterface {
  // A copy, so the SDK gets exactly the seed's 32 bytes whatever buffer the
  // Uint8Array is a view of.
  return SharingKey.fromSeed(new Uint8Array(key.seed).buffer)
}

export class MobileSdkAdapter implements SdkAdapter {
  private sdk: SdkInterface

  constructor(sdk: SdkInterface) {
    this.sdk = sdk
  }

  async objectEvents(cursor: ObjectsCursor | undefined, limit: number): Promise<ObjectEvent[]> {
    return this.sdk.objectEvents(cursor, limit) as Promise<ObjectEvent[]>
  }

  async updateObjectMetadata(pinnedObject: PinnedObjectRef): Promise<void> {
    await this.sdk.updateObjectMetadata(native(pinnedObject))
  }

  async download(
    pinnedObject: PinnedObjectRef,
    options: DownloadOptions,
  ): Promise<DownloadLikeRef> {
    return this.sdk.download(native(pinnedObject), options)
  }

  async downloadByObjectId(objectId: string): Promise<ArrayBuffer> {
    const obj = await this.sdk.object(objectId)
    const dl = this.sdk.download(obj, {
      offset: 0n,
      length: undefined,
    })
    const chunks: ArrayBuffer[] = []
    try {
      while (true) {
        const chunk = await dl.read()
        if (chunk.byteLength === 0) break
        chunks.push(chunk)
      }
    } finally {
      await dl.cancel().catch(() => {})
    }
    const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0)
    const combined = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      combined.set(new Uint8Array(chunk), offset)
      offset += chunk.byteLength
    }
    return combined.buffer.slice(0, totalLength) as ArrayBuffer
  }

  async uploadPacked(options: UploadOptions): Promise<PackedUploadRef> {
    return this.sdk.uploadPacked(options) as PackedUploadRef
  }

  async pinObject(pinnedObject: PinnedObjectRef): Promise<void> {
    await this.sdk.pinObject(native(pinnedObject))
  }

  async deleteObject(objectId: string): Promise<void> {
    await this.sdk.deleteObject(objectId)
  }

  async getPinnedObject(objectId: string): Promise<PinnedObjectRef> {
    return this.sdk.object(objectId) as Promise<PinnedObjectRef>
  }

  async objectFromShareUrl(url: string): Promise<PinnedObjectRef> {
    return this.sdk.objectFromShareUrl(url) as Promise<PinnedObjectRef>
  }

  async createSharingKey(description: string, expiresAt?: Date): Promise<SharingKeyRef> {
    return sharingKeyRef(await this.sdk.createSharingKey(description, expiresAt))
  }

  async sharingKeys(offset: number, limit: number): Promise<SharingKeyRecord[]> {
    const records = await this.sdk.sharingKeys(offset, limit)
    return records.map((r) => ({
      key: sharingKeyRef(r.key),
      description: r.description,
      expiresAt: r.stats.expiresAt,
      createdAt: r.stats.createdAt,
      objectCount: Number(r.stats.objectCount),
    }))
  }

  async shareObject(key: SharingKeyRef, object: PinnedObjectRef): Promise<void> {
    await this.sdk.shareObject(nativeSharingKey(key), native(object))
  }

  async sharedObjects(
    key: SharingKeyRef,
    offset: number,
    limit: number,
  ): Promise<PinnedObjectRef[]> {
    return this.sdk.sharedObjects(nativeSharingKey(key), offset, limit) as Promise<
      PinnedObjectRef[]
    >
  }

  async unshareObject(key: SharingKeyRef, objectId: string): Promise<void> {
    await this.sdk.unshareObject(nativeSharingKey(key), objectId)
  }

  async revokeSharingKey(key: SharingKeyRef): Promise<void> {
    await this.sdk.revokeSharingKey(nativeSharingKey(key))
  }

  openAppKey(bytes: Uint8Array): AppKeyRef {
    return new AppKey(bytes.buffer as ArrayBuffer) as AppKeyRef
  }

  openPinnedObject(appKey: AppKeyRef, object: LocalObject): PinnedObjectRef {
    return PinnedObject.open(appKey as AppKeyInterface, object) as PinnedObjectRef
  }

  appKey(): AppKeyRef {
    return this.sdk.appKey() as AppKeyRef
  }

  async hosts(): Promise<Host[]> {
    return this.sdk.hosts(undefined) as Promise<Host[]>
  }

  async account(): Promise<Account> {
    return this.sdk.account() as Promise<Account>
  }

  async pruneSlabs(): Promise<void> {
    await this.sdk.pruneSlabs()
  }
}
