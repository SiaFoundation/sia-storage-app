import type {
  AppKeyRef,
  DownloadOptions,
  ObjectEvent,
  ObjectsCursor,
  PackedUploadRef,
  PinnedObjectRef,
  SdkAdapter,
  UploadOptions,
  Writer,
} from '@siastorage/core/adapters'
import type { SdkInterface } from 'react-native-sia'

export class MobileSdkAdapter implements SdkAdapter {
  private sdk: SdkInterface

  constructor(sdk: SdkInterface) {
    this.sdk = sdk
  }

  async objectEvents(
    cursor: ObjectsCursor | undefined,
    limit: number,
  ): Promise<ObjectEvent[]> {
    return this.sdk.objectEvents(cursor, limit) as Promise<ObjectEvent[]>
  }

  async updateObjectMetadata(pinnedObject: PinnedObjectRef): Promise<void> {
    await this.sdk.updateObjectMetadata(pinnedObject)
  }

  async download(
    writer: Writer,
    pinnedObject: PinnedObjectRef,
    options: DownloadOptions,
    control?: { signal: AbortSignal },
  ): Promise<void> {
    await this.sdk.download(writer, pinnedObject, options, control)
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

  appKey(): AppKeyRef {
    return this.sdk.appKey() as AppKeyRef
  }
}
