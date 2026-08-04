import type { AppKeyRef, SdkAdapter } from '@siastorage/core/adapters'
import { fileUriToPath } from '@siastorage/core/lib/fileUri'
import type { UploaderAdapters } from '@siastorage/core/services/uploader'
import type { MockSdk } from '@siastorage/sdk-mock'

export function buildTestSdkAdapter(sdk: MockSdk, appKey: AppKeyRef): SdkAdapter {
  return {
    objectEvents: (cursor, limit) => sdk.objectEvents(cursor, limit),
    updateObjectMetadata: (po) => sdk.updateObjectMetadata(po),
    download: (po, opts) => sdk.download(po, opts),
    uploadPacked: (opts) => sdk.uploadPacked(opts),
    pinObject: (po) => sdk.pinObject(po),
    deleteObject: (id) => sdk.deleteObject(id),
    getPinnedObject: (id) => sdk.getPinnedObject(id),
    sharedObject: (url) => sdk.sharedObject(url),
    shareObject: () => '',
    openAppKey: (bytes) => sdk.openAppKey(bytes),
    openPinnedObject: (key, object) => sdk.openPinnedObject(key, object),
    appKey: () => appKey,
    downloadByObjectId: (id) => sdk.downloadByObjectId(id),
    hosts: async () => [],
    account: async () => ({ publicKey: '', storage: BigInt(0), app: null }) as any,
    pruneSlabs: () => sdk.pruneSlabs(),
  }
}

export function createTestUploaderAdapters(): UploaderAdapters {
  return {
    toFilePath: fileUriToPath,
  }
}
