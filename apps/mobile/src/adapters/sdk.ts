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
  UploadOptions,
} from '@siastorage/core/adapters'
import type { SdkInterface } from 'react-native-sia'

export class MobileSdkAdapter implements SdkAdapter {
  private sdk: SdkInterface

  constructor(sdk: SdkInterface) {
    this.sdk = sdk
  }

  async objectEvents(cursor: ObjectsCursor | undefined, limit: number): Promise<ObjectEvent[]> {
    return this.sdk.objectEvents(cursor, limit) as Promise<ObjectEvent[]>
  }

  async updateObjectMetadata(pinnedObject: PinnedObjectRef): Promise<void> {
    await this.sdk.updateObjectMetadata(pinnedObject)
  }

  async download(
    pinnedObject: PinnedObjectRef,
    options: DownloadOptions,
  ): Promise<DownloadLikeRef> {
    return this.sdk.download(pinnedObject, options)
  }

  async downloadByObjectId(objectId: string): Promise<ArrayBuffer> {
    const obj = await this.sdk.object(objectId)
    const dl = this.sdk.download(obj, {
      maxInflight: 1,
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
    return this.sdk.uploadPacked(options) as Promise<PackedUploadRef>
  }

  async pinObject(pinnedObject: PinnedObjectRef): Promise<void> {
    await this.sdk.pinObject(pinnedObject)
  }

  async deleteObject(objectId: string): Promise<void> {
    await this.sdk.deleteObject(objectId)
  }

  async getPinnedObject(objectId: string): Promise<PinnedObjectRef> {
    return this.sdk.object(objectId) as Promise<PinnedObjectRef>
  }

  async sharedObject(url: string): Promise<PinnedObjectRef> {
    return this.sdk.sharedObject(url) as Promise<PinnedObjectRef>
  }

  shareObject(object: PinnedObjectRef, validUntil: Date): string {
    return this.sdk.shareObject(object, validUntil)
  }

  appKey(): AppKeyRef {
    return this.sdk.appKey() as AppKeyRef
  }

  async hosts(): Promise<Host[]> {
    return this.sdk.hosts() as Promise<Host[]>
  }

  async account(): Promise<Account> {
    return this.sdk.account() as Promise<Account>
  }
}
