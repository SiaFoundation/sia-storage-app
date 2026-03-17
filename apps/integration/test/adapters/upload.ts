import type { AppKeyRef, SdkAdapter } from '@siastorage/core/adapters'
import type { UploaderAdapters } from '@siastorage/core/services/uploader'
import type { MockSdk } from '@siastorage/sdk-mock'
import * as nodeFs from 'fs'

export function buildTestSdkAdapter(
  sdk: MockSdk,
  appKey: AppKeyRef,
): SdkAdapter {
  return {
    objectEvents: (cursor, limit) => sdk.objectEvents(cursor, limit),
    updateObjectMetadata: (po) => sdk.updateObjectMetadata(po),
    download: async () => {},
    uploadPacked: (opts) => sdk.uploadPacked(opts),
    pinObject: (po) => sdk.pinObject(po),
    deleteObject: (id) => sdk.deleteObject(id),
    getPinnedObject: (id) => sdk.getPinnedObject(id),
    sharedObject: (url) => sdk.sharedObject(url),
    shareObject: () => '',
    appKey: () => appKey,
    downloadByObjectId: async () => new ArrayBuffer(0),
    hosts: async () => [],
    account: async () =>
      ({ publicKey: '', storage: BigInt(0), app: null }) as any,
  }
}

export function createTestUploaderAdapters(): UploaderAdapters {
  return {
    createFileReader: (uri) => {
      const filePath = uri.replace('file://', '')
      return {
        async read() {
          const data = nodeFs.readFileSync(filePath)
          return data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength,
          )
        },
      }
    },
  }
}
