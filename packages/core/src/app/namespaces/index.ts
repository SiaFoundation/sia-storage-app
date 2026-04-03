import type { SdkAuthAdapters } from '../../adapters/auth'
import type { CryptoAdapter } from '../../adapters/crypto'
import type { DatabaseAdapter } from '../../adapters/db'
import type { ObjectsCursor, SdkAdapter } from '../../adapters/sdk'
import type { StorageAdapter } from '../../adapters/storage'
import type { ThumbnailAdapter } from '../../adapters/thumbnail'
import type { FsIOAdapter } from '../../services/fsFileUri'
import type { SyncUpCursor } from '../../services/syncUpMetadata'
import type { UploaderAdapters, UploadManager } from '../../services/uploader'
import { swrCacheBy } from '../../stores/swr'
import { createLibraryVersionCache } from '../libraryVersionCache'
import type { AppCaches, AppService, AppServiceInternal } from '../service'
import type { ConnectionState, InitState, SyncState } from '../stores'
import { buildAuthNamespace } from './auth'
import { buildDbNamespaces } from './db'
import {
  buildDownloadsNamespace,
  type DownloadObjectAdapter,
} from './downloads'
import { buildSettingsNamespace } from './settings'
import { buildUploaderNamespace, initUploader } from './uploader'
import { buildUploadsNamespace } from './uploads'

export type { UploaderAdapters }

/** All adapters required to create an AppService instance. */
export interface AppServiceAdapters {
  db: DatabaseAdapter
  storage: StorageAdapter
  secrets: StorageAdapter
  crypto: CryptoAdapter
  fsIO: FsIOAdapter
  downloadObject: DownloadObjectAdapter
  uploader: UploaderAdapters
  sdkAuth: SdkAuthAdapters
  thumbnail?: ThumbnailAdapter
  detectMimeType?: (path: string) => Promise<string | null>
}

/** The result of creating an AppService: the public service, internal APIs, and upload manager. */
export interface AppServiceResult {
  service: AppService
  internal: AppServiceInternal
  uploadManager: UploadManager
}

/**
 * Creates the AppService facade with all namespaces wired together.
 * Called once per platform (mobile, desktop main, CLI, web).
 */
export function createAppService(
  adapters: AppServiceAdapters,
): AppServiceResult {
  const caches: AppCaches = {
    tags: swrCacheBy(),
    directories: swrCacheBy(),
    library: swrCacheBy(),
    fileById: swrCacheBy(),
    thumbnails: {
      best: swrCacheBy(),
      byFileId: swrCacheBy(),
    },
    libraryVersion: createLibraryVersionCache(),
    settings: swrCacheBy(),
    sync: swrCacheBy(),
    uploads: swrCacheBy(),
    downloads: swrCacheBy(),
    connection: swrCacheBy(),
    init: swrCacheBy(),
    sdk: swrCacheBy(),
    hosts: swrCacheBy(),
  }

  let sdkRef: SdkAdapter | null = null

  let syncState: SyncState = {
    isLeader: false,
    isSyncingDown: false,
    syncDownCount: 0,
    syncDownProgress: 0,
    isSyncingUp: false,
    syncUpProcessed: 0,
    syncUpTotal: 0,
    syncGateStatus: 'idle',
  }

  let connectionState: ConnectionState = {
    isConnected: false,
    connectionError: null,
    isAuthing: false,
    isReconnecting: false,
  }

  let initState: InitState = {
    steps: {},
    isInitializing: false,
    initializationError: null,
  }

  const uploadsNamespace = buildUploadsNamespace(caches)

  const { namespace: uploaderNamespace, manager: uploadManager } =
    buildUploaderNamespace(adapters.db, adapters.fsIO)

  const downloadsNamespace = buildDownloadsNamespace(
    adapters.db,
    adapters.fsIO,
    adapters.downloadObject,
    adapters.storage,
    caches,
    () => sdkRef,
  )

  const service: AppService = {
    optimize: () => adapters.db.execAsync('PRAGMA optimize'),
    ...buildDbNamespaces(adapters.db, caches, uploadsNamespace, adapters.fsIO, {
      crypto: adapters.crypto,
      thumbnail: adapters.thumbnail,
      detectMimeType: adapters.detectMimeType,
    }),
    settings: buildSettingsNamespace(adapters.storage, caches),
    storage: {
      getItem: (k) => adapters.storage.getItem(k),
      setItem: (k, v) => adapters.storage.setItem(k, v),
      removeItem: (k) => adapters.storage.deleteItem(k),
    },
    secrets: {
      getItem: (k) => adapters.secrets.getItem(k),
      setItem: (k, v) => adapters.secrets.setItem(k, v),
      deleteItem: (k) => adapters.secrets.deleteItem(k),
    },
    auth: buildAuthNamespace(
      adapters.secrets,
      adapters.crypto,
      adapters.sdkAuth,
    ),
    sync: {
      getState: () => ({ ...syncState }),
      setState: (patch) => {
        syncState = { ...syncState, ...patch }
        caches.sync.invalidate()
      },
      getSyncDownCursor: async () => {
        const raw = await adapters.storage.getItem('syncDownCursor')
        if (!raw) return undefined
        const parsed = JSON.parse(raw)
        return { id: parsed.id, after: new Date(parsed.after) } as ObjectsCursor
      },
      setSyncDownCursor: async (cursor: ObjectsCursor | undefined) => {
        if (!cursor) {
          await adapters.storage.setItem('syncDownCursor', '')
        } else {
          await adapters.storage.setItem(
            'syncDownCursor',
            JSON.stringify({
              id: cursor.id,
              after: cursor.after.getTime(),
            }),
          )
        }
      },
      getSyncUpCursor: async () => {
        const raw = await adapters.storage.getItem('syncUpCursor')
        if (!raw) return undefined
        return JSON.parse(raw) as SyncUpCursor
      },
      setSyncUpCursor: async (cursor: SyncUpCursor | undefined) => {
        if (!cursor) {
          await adapters.storage.setItem('syncUpCursor', '')
        } else {
          await adapters.storage.setItem('syncUpCursor', JSON.stringify(cursor))
        }
      },
    },
    uploads: uploadsNamespace,
    downloads: downloadsNamespace,
    connection: {
      getState: () => ({ ...connectionState }),
      setState: (patch) => {
        connectionState = { ...connectionState, ...patch }
        caches.connection.invalidate()
      },
    },
    init: {
      getState: () => ({ ...initState }),
      setState: (patch) => {
        initState = { ...initState, ...patch }
        caches.init.set({ ...initState })
      },
      setStep: (step) => {
        initState = {
          ...initState,
          steps: { ...initState.steps, [step.id]: step },
        }
        caches.init.set({ ...initState })
      },
      removeStep: (id) => {
        const { [id]: _, ...rest } = initState.steps
        initState = { ...initState, steps: rest }
        caches.init.set({ ...initState })
      },
    },
    uploader: uploaderNamespace,
    hosts: async () => {
      if (!sdkRef) throw new Error('SDK not initialized')
      return sdkRef.hosts()
    },
    account: async () => {
      if (!sdkRef) throw new Error('SDK not initialized')
      return sdkRef.account()
    },
    caches,
  }

  const internal: AppServiceInternal = {
    setSdk: (sdk) => {
      sdkRef = sdk
      caches.sdk.invalidate()
    },
    getSdk: () => sdkRef,
    requireSdk: () => {
      if (!sdkRef) throw new Error('SDK not initialized')
      return sdkRef
    },
    initUploader: () =>
      initUploader(uploadManager, service, internal, adapters.uploader),
    withTransaction: (fn) => adapters.db.withTransactionAsync(fn),
  }

  return { service, internal, uploadManager }
}
