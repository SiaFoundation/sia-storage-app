import type { ThumbnailAdapter } from '@siastorage/core/adapters'
import type { AppService, AppServiceInternal } from '@siastorage/core/app'
import { createAppService } from '@siastorage/core/app'
import { runMigrations } from '@siastorage/core/db'
import { coreMigrations, sortMigrations } from '@siastorage/core/db/migrations'
import type {
  Directory,
  DirectoryWithCount,
  Tag,
  TagWithCount,
} from '@siastorage/core/db/operations'
import type { LocalObject } from '@siastorage/core/encoding/localObject'
import { detectMimeType } from '@siastorage/core/lib/detectMimeType'
import { ServiceScheduler } from '@siastorage/core/lib/serviceInterval'
import type { FsIOAdapter } from '@siastorage/core/services/fsFileUri'
import { syncDownEventsBatch } from '@siastorage/core/services/syncDownEvents'
import { syncUpMetadataBatch } from '@siastorage/core/services/syncUpMetadata'
import { ThumbnailScanner } from '@siastorage/core/services/thumbnailScanner'
import type { UploadManager } from '@siastorage/core/services/uploader'
import type { FileRecord, FileRecordRow } from '@siastorage/core/types'
import { createBetterSqlite3Database } from '@siastorage/node-adapters/database'
import { createInMemoryStorage } from '@siastorage/node-adapters/storage'
import {
  createEmptyIndexerStorage,
  type MockIndexerStorage,
  MockSdk,
} from '@siastorage/sdk-mock'
import * as nodeFs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  buildTestSdkAdapter,
  createFsAdapter,
  createMockFsIO,
  createMockThumbnailAdapter,
  createSharpThumbnailAdapter,
  createTestUploaderAdapters,
} from './adapters'
import {
  type TestFileFactory,
  type TestFileInput,
  type UploadState,
  waitForCondition,
} from './utils'

export {
  generateTestFiles,
  sleep,
  type TestFileFactory,
  type TestFileInput,
  type UploadState,
  waitForCondition,
} from './utils'

const INDEXER_URL = 'https://test.indexer'
const SYNC_INTERVAL = 200
const THUMBNAIL_SCAN_INTERVAL = 1000
const DB_OPTIMIZE_INTERVAL = 5000

export interface TestAppOptions {
  fsIO?: Partial<FsIOAdapter>
  thumbnail?: Partial<ThumbnailAdapter>
  crypto?: { sha256: (data: ArrayBuffer) => Promise<string> }
  detectMimeType?: (path: string) => Promise<string | null>
}

export interface TestApp {
  start(): Promise<void>
  shutdown(): Promise<void>
  pause(): void
  resume(): void

  app: AppService
  internal: AppServiceInternal
  sdk: MockSdk
  uploadManager: UploadManager
  thumbnailScanner: ThumbnailScanner
  tempDir: string

  getFiles(): Promise<FileRecord[]>
  getFileById(id: string): Promise<FileRecord | null>

  triggerSyncDown(): void
  triggerSyncUp(): void
  triggerThumbnailScan(): void

  waitForFileCount(count: number, timeout?: number): Promise<void>
  waitForCondition(
    fn: () => boolean | Promise<boolean>,
    timeout?: number,
  ): Promise<void>
  waitForNoActiveUploads(timeout?: number): Promise<void>
  waitForUploadStatus(
    fileId: string,
    status: string | 'removed',
    timeout?: number,
  ): Promise<void>
  waitForUploadCount(count: number, timeout?: number): Promise<void>
  waitForThumbnails(fileIds: string[], timeout?: number): Promise<void>

  getUploadState(fileId: string): UploadState | undefined
  getUploadCounts(): { total: number }
  getActiveUploads(): Array<{ id: string; status: string }>
  getActiveUploadCount(): number

  readThumbnailsByFileId(fileId: string): Promise<FileRecord[]>

  createFileRecord(record: {
    id: string
    name: string
    type: string
    kind: string
    size: number
    hash: string
    createdAt: number
    updatedAt: number
    localId?: string | null
    addedAt?: number
    trashedAt?: number | null
    deletedAt?: number | null
    thumbForId?: string
    thumbSize?: number
  }): Promise<void>

  addFiles(fileFactories: TestFileFactory[]): Promise<TestFileInput[]>

  addTagToFile(fileId: string, tagName: string): Promise<void>
  readTagsForFile(fileId: string): Promise<Tag[]>
  readAllTagsWithCounts(): Promise<TagWithCount[]>
  renameTag(tagId: string, newName: string): Promise<void>

  createDirectory(name: string): Promise<Directory>
  moveFileToDirectory(fileId: string, dirId: string): Promise<void>
  renameDirectory(dirId: string, newName: string): Promise<void>
  readDirectoryPathForFile(fileId: string): Promise<string | undefined>
  readAllDirectoriesWithCounts(): Promise<DirectoryWithCount[]>

  updateFileRecord(
    update: Partial<FileRecordRow> & { id: string },
    opts?: { includeUpdatedAt?: boolean },
  ): Promise<void>
  readLocalObjectsForFile(fileId: string): Promise<LocalObject[]>

  removeFsFile(fileId: string, type: string): Promise<void>
  listFsFiles(): Promise<string[]>
  getFsFileUri(file: { id: string; type: string }): Promise<string | null>

  setConnected(connected: boolean): void
  areServicesRunning(): boolean
}

export function createTestApp(
  indexerStorage?: MockIndexerStorage,
  options?: TestAppOptions,
): TestApp {
  const db = createBetterSqlite3Database()
  const storage = createInMemoryStorage()
  const scheduler = new ServiceScheduler()
  const sdk = new MockSdk(indexerStorage ?? createEmptyIndexerStorage())
  const appKey = sdk.appKey()
  const thumbnailScanner = new ThumbnailScanner()
  let connected = true

  const hasMockAdapters = options?.fsIO || options?.thumbnail
  const tempDir = hasMockAdapters
    ? ''
    : nodeFs.mkdtempSync(path.join(os.tmpdir(), 'core-test-'))

  const secrets = createInMemoryStorage()
  const crypto = options?.crypto ?? {
    sha256: async (data: ArrayBuffer) => {
      const { createHash } = await import('crypto')
      const hash = createHash('sha256').update(Buffer.from(data)).digest('hex')
      return hash
    },
  }

  const fsIO = options?.fsIO
    ? createMockFsIO(options.fsIO)
    : createFsAdapter({ tempDir }).fsIO
  const testSdkAdapter = buildTestSdkAdapter(sdk, appKey)

  const thumbnailAdapter = options?.thumbnail
    ? createMockThumbnailAdapter(options.thumbnail)
    : createSharpThumbnailAdapter()

  const detectMimeTypeFn =
    options?.detectMimeType ??
    (async (filePath: string) => {
      const resolved = filePath.replace('file://', '')
      const result = detectMimeType({ fileName: resolved })
      return result === 'application/octet-stream' ? null : result
    })

  const {
    service: appService,
    internal,
    uploadManager,
  } = createAppService({
    db,
    storage,
    secrets,
    crypto,
    fsIO,
    downloadObject: {
      async download({ file, object, sdk, onProgress }) {
        const data = await sdk.downloadByObjectId(object.id)
        onProgress(1)
        if (!fsIO.writeFile) throw new Error('writeFile not implemented')
        await fsIO.writeFile(file, data)
      },
    },
    uploader: createTestUploaderAdapters(),
    sdkAuth: {
      createBuilder: async (_indexerUrl: string, _appMeta: string) => {},
      requestConnection: async () => '',
      waitForApproval: async () => {},
      connectWithKey: async () => false,
      register: async () => '',
      generateRecoveryPhrase: () => '',
      validateRecoveryPhrase: () => {},
      cancelAuth: () => {},
    },
    thumbnail: thumbnailAdapter,
    detectMimeType: detectMimeTypeFn,
  })
  function runSyncDown(signal: AbortSignal) {
    if (!connected) return
    return syncDownEventsBatch(signal, appService, internal)
  }

  function runSyncUp(signal: AbortSignal) {
    if (!connected) return
    return syncUpMetadataBatch(100, 5, signal, appService, internal)
  }

  async function runThumbScan(signal: AbortSignal) {
    await thumbnailScanner.runScan(signal)
  }

  const syncDown = scheduler.createInterval({
    name: 'syncDownEvents',
    worker: runSyncDown,
    interval: SYNC_INTERVAL,
  })

  const syncUp = scheduler.createInterval({
    name: 'syncUpMetadata',
    worker: runSyncUp,
    interval: SYNC_INTERVAL,
  })

  const thumbScan = scheduler.createInterval({
    name: 'thumbnailScanner',
    worker: runThumbScan,
    interval: THUMBNAIL_SCAN_INTERVAL,
  })

  const dbOptimize = scheduler.createInterval({
    name: 'dbOptimize',
    worker: () => appService.optimize(),
    interval: DB_OPTIMIZE_INTERVAL,
  })

  return {
    app: appService,
    internal,
    sdk,
    uploadManager,
    thumbnailScanner,
    tempDir,

    async start() {
      await runMigrations(db, sortMigrations(coreMigrations))
      await appService.optimize()
      internal.setSdk(testSdkAdapter)
      appService.connection.setState({ isConnected: true })
      await appService.settings.setIndexerURL(INDEXER_URL)
      internal.initUploader()
      dbOptimize.init()
      syncDown.init()
      syncUp.init()
      thumbnailScanner.initialize(appService)
      thumbScan.init()
    },

    async shutdown() {
      await appService.uploader.shutdown()
      thumbnailScanner.reset()
      await scheduler.shutdown()
      await new Promise((r) => setTimeout(r, 100))
      db.close()
      if (tempDir) {
        try {
          nodeFs.rmSync(tempDir, { recursive: true })
        } catch {
          // ignore cleanup errors
        }
      }
    },

    pause() {
      scheduler.pause()
    },

    resume() {
      scheduler.resume()
    },

    triggerSyncDown() {
      syncDown.triggerNow()
    },

    triggerSyncUp() {
      syncUp.triggerNow()
    },

    triggerThumbnailScan() {
      thumbScan.triggerNow()
    },

    async getFiles() {
      return appService.files.query({ order: 'ASC' })
    },

    async getFileById(id) {
      return appService.files.getById(id)
    },

    async waitForFileCount(count, timeout = 15_000) {
      const start = Date.now()
      while (Date.now() - start < timeout) {
        const files = await appService.files.query({ order: 'ASC' })
        if (files.length === count) return
        await new Promise((r) => setTimeout(r, 50))
      }
      const final = await appService.files.query({ order: 'ASC' })
      throw new Error(
        `Expected ${count} files but got ${final.length} within ${timeout}ms`,
      )
    },

    async waitForCondition(fn, timeout = 15_000) {
      const start = Date.now()
      while (Date.now() - start < timeout) {
        if (await fn()) return
        await new Promise((r) => setTimeout(r, 50))
      }
      throw new Error(`Condition not met within ${timeout}ms`)
    },

    async waitForNoActiveUploads(timeout = 30_000) {
      await waitForCondition(
        async () => {
          const { uploads } = appService.uploads.getState()
          const active = Object.values(uploads).filter(
            (u) => u.status !== 'error' && u.status !== 'done',
          )
          if (active.length > 0) return false
          const pending = await appService.files.query({
            limit: 1,
            order: 'ASC',
            pinned: { indexerURL: INDEXER_URL, isPinned: false },
            fileExistsLocally: true,
          })
          return pending.length === 0
        },
        { timeout, message: 'No active uploads and no pending files' },
      )
    },

    async waitForUploadStatus(fileId, status, timeout = 30_000) {
      await waitForCondition(
        () => {
          const entry = appService.uploads.getEntry(fileId)
          if (status === 'removed') return entry === undefined
          return entry?.status === status
        },
        { timeout, message: `Upload ${fileId} to reach ${status}` },
      )
    },

    async waitForUploadCount(count, timeout = 30_000) {
      await waitForCondition(
        () => {
          const { uploads } = appService.uploads.getState()
          return Object.keys(uploads).length === count
        },
        {
          timeout,
          message: `Upload count to be ${count}`,
        },
      )
    },

    async waitForThumbnails(fileIds, timeout = 30_000) {
      await waitForCondition(
        async () => {
          for (const fileId of fileIds) {
            const thumbs = await appService.thumbnails.getForFile(fileId)
            if (thumbs.length === 0) return false
          }
          return true
        },
        { timeout, message: 'Thumbnails to be generated' },
      )
    },

    getUploadState: (fileId) => {
      const entry = appService.uploads.getEntry(fileId)
      if (!entry) return undefined
      return {
        id: entry.id,
        status: entry.status,
        progress: entry.progress,
        size: entry.size,
        error: entry.error,
        batchId: entry.batchId,
        batchCount: entry.batchFileCount,
      }
    },
    getUploadCounts: () => {
      const { uploads } = appService.uploads.getState()
      return { total: Object.keys(uploads).length }
    },
    getActiveUploads: () => {
      const { uploads } = appService.uploads.getState()
      return Object.values(uploads)
        .filter((u) => u.status !== 'error' && u.status !== 'done')
        .map((u) => ({ id: u.id, status: u.status }))
    },
    getActiveUploadCount: () => {
      const { uploads } = appService.uploads.getState()
      return Object.values(uploads).filter(
        (u) => u.status !== 'error' && u.status !== 'done',
      ).length
    },

    readThumbnailsByFileId: (fileId) =>
      appService.thumbnails.getForFile(fileId),

    async createFileRecord(record) {
      const now = Date.now()
      await appService.files.create({
        addedAt: now,
        trashedAt: null,
        deletedAt: null,
        localId: null,
        ...record,
      } as Parameters<AppService['files']['create']>[0])
    },

    async addFiles(fileFactories) {
      const now = Date.now()
      const files: TestFileInput[] = []
      for (const factory of fileFactories) {
        const file = factory(tempDir)
        files.push(file)
        await appService.files.create({
          id: file.id,
          name: file.name,
          type: file.type,
          kind: 'file',
          size: file.size,
          hash: file.hash,
          createdAt: now,
          updatedAt: now,
          localId: null,
          addedAt: now,
          trashedAt: null,
          deletedAt: null,
        })
        await appService.fs.upsertMeta({
          fileId: file.id,
          size: file.size,
          addedAt: now,
          usedAt: now,
        })
      }
      return files
    },

    async addTagToFile(fileId, tagName) {
      await appService.tags.add(fileId, tagName)
    },

    readTagsForFile: (fileId) => appService.tags.getForFile(fileId),
    readAllTagsWithCounts: () => appService.tags.getAll(),

    async renameTag(tagId, newName) {
      await appService.tags.rename(tagId, newName)
    },

    createDirectory: (name) => appService.directories.create(name),

    async moveFileToDirectory(fileId, dirId) {
      await appService.directories.moveFile(fileId, dirId)
    },

    async renameDirectory(dirId, newName) {
      await appService.directories.rename(dirId, newName)
    },

    readDirectoryPathForFile: (fileId) =>
      appService.directories.getPathForFile(fileId),
    readAllDirectoriesWithCounts: () => appService.directories.getAll(),

    updateFileRecord: (update, opts) => appService.files.update(update, opts),

    readLocalObjectsForFile: (fileId) =>
      appService.localObjects.getForFile(fileId),

    async removeFsFile(fileId, type) {
      await appService.fs.removeFile({ id: fileId, type })
    },

    listFsFiles() {
      return appService.fs.listFiles()
    },

    getFsFileUri: (file) => appService.fs.getFileUri(file),

    setConnected(c) {
      connected = c
      sdk.setConnected(c)
      appService.connection.setState({ isConnected: c })
    },

    areServicesRunning() {
      return !scheduler.isPaused()
    },
  }
}
