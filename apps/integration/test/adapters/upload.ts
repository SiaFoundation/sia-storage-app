import type {
  AppKeyRef,
  DatabaseAdapter,
  Reader,
} from '@siastorage/core/adapters'
import {
  insertLocalObject,
  queryFileRecordById,
  queryLocalOnlyFiles,
} from '@siastorage/core/db/operations'
import { sealPinnedObject } from '@siastorage/core/lib/localObjects'
import type { UploadDeps } from '@siastorage/core/services/uploader'
import type { MockSdk } from '@siastorage/sdk-mock'
import * as nodeFs from 'fs'
import type { UploadState } from '../utils'

export function buildUploadDeps(params: {
  db: DatabaseAdapter
  sdk: MockSdk
  appKey: AppKeyRef
  indexerURL: string
  connected: () => boolean
  uploads: Map<string, UploadState>
  getFsFileUri: (file: { id: string; type: string }) => Promise<string | null>
}): UploadDeps {
  const { db, sdk, appKey, indexerURL, connected, uploads, getFsFileUri } =
    params
  return {
    sdk: {
      uploadPacked: (opts: any) => sdk.uploadPacked(opts),
      pinObject: (po: any) => sdk.pinObject(po),
    },
    files: {
      read: async (id) => queryFileRecordById(db, id),
      getLocalOnly: async (opts) =>
        queryLocalOnlyFiles(db, indexerURL, {
          limit: opts.limit,
          order: opts.order,
          excludeIds: opts.excludeIds,
        }),
      getFsFileUri: (file) => getFsFileUri(file),
    },
    localObjects: {
      upsert: (lo) => insertLocalObject(db, lo),
    },
    platform: {
      isConnected: () => connected(),
      autoScanEnabled: async () => true,
      getIndexerURL: () => indexerURL,
      createFileReader: (uri: string): Reader => {
        const filePath = uri.replace('file://', '')
        return {
          async read(): Promise<ArrayBuffer> {
            const data = nodeFs.readFileSync(filePath)
            return data.buffer.slice(
              data.byteOffset,
              data.byteOffset + data.byteLength,
            )
          },
        }
      },
      pinnedObjectToLocalObject: async (fileId, url, object: any) =>
        sealPinnedObject(fileId, url, object, appKey),
    },
    uploads: {
      register: (fileId, size) => {
        uploads.set(fileId, {
          id: fileId,
          status: 'pending',
          progress: 0,
          size,
        })
      },
      remove: (fileId) => {
        uploads.delete(fileId)
      },
      setStatus: (fileId, status) => {
        const u = uploads.get(fileId)
        if (u) u.status = status as UploadState['status']
      },
      setError: (fileId, message) => {
        const u = uploads.get(fileId)
        if (u) {
          u.status = 'error'
          u.error = message
        }
      },
      setBatchInfo: (fileId, batchId, count) => {
        const u = uploads.get(fileId)
        if (u) {
          u.batchId = batchId
          u.batchCount = count
        }
      },
      updateProgress: (fileId, progress) => {
        const u = uploads.get(fileId)
        if (u) u.progress = progress
      },
      getActive: () =>
        Array.from(uploads.values())
          .filter((u) => u.status !== 'error')
          .map((u) => ({ id: u.id })),
    },
  }
}
