import {
  type AppService,
  // oxlint-disable-next-line no-restricted-imports -- mobile bootstrap needs internal access to wire SDK and uploader
  type AppServiceInternal,
  type AppServiceResult,
  createAppService,
} from '@siastorage/core/app'
import type { UploadManager } from '@siastorage/core/services/uploader'
import { MobileSdkAuthAdapter } from '../adapters/auth'
import { createCryptoAdapter } from '../adapters/crypto'
import { createDownloadAdapter } from '../adapters/downloadObject'
import { createFsIOAdapter } from '../adapters/fsIO'
import { createSecretsAdapter, createStorageAdapter } from '../adapters/storage'
import { createMobileThumbnailAdapter } from '../adapters/thumbnail'
import { createUploaderAdapters } from '../adapters/uploader'
import { db } from '../db'
import { detectMimeType } from '../lib/detectMimeType'

const mobileSdkAuth = new MobileSdkAuthAdapter()

let _app: AppService | null = null
let _internal: AppServiceInternal | null = null
let _uploadManager: UploadManager | null = null

function ensureApp(): AppServiceResult {
  if (_app && _internal && _uploadManager)
    return { service: _app, internal: _internal, uploadManager: _uploadManager }
  const result = createAppService({
    db: db(),
    storage: createStorageAdapter(),
    secrets: createSecretsAdapter(),
    crypto: createCryptoAdapter(),
    fsIO: createFsIOAdapter(),
    downloadObject: createDownloadAdapter(),
    uploader: createUploaderAdapters(),
    sdkAuth: mobileSdkAuth,
    thumbnail: createMobileThumbnailAdapter(),
    detectMimeType: (path) => detectMimeType(path),
  })
  _app = result.service
  _internal = result.internal
  _uploadManager = result.uploadManager
  return result
}

export function app(): AppService {
  return ensureApp().service
}

export function internal(): AppServiceInternal {
  return ensureApp().internal
}

export function getMobileSdkAuth(): MobileSdkAuthAdapter {
  return mobileSdkAuth
}

export function getUploadManager(): UploadManager | null {
  return ensureApp().uploadManager
}

export function resetApp(): void {
  _app = null
  _internal = null
  _uploadManager = null
}
