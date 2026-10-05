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
    objectFromShareUrl: (url) => sdk.objectFromShareUrl(url),
    objectShareUrl: () => '',
    createSharingKey: (description, expiresAt) => sdk.createSharingKey(description, expiresAt),
    sharingKeys: (offset, limit) => sdk.sharingKeys(offset, limit),
    shareObject: (key, po) => sdk.shareObject(key, po),
    sharedObjects: (key, offset, limit) => sdk.sharedObjects(key, offset, limit),
    unshareObject: (key, id) => sdk.unshareObject(key, id),
    revokeSharingKey: (key) => sdk.revokeSharingKey(key),
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
