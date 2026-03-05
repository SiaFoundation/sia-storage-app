import type { DatabaseAdapter } from '@siastorage/core/adapters'
import { runMigrations } from '@siastorage/core/db'
import { coreMigrations, sortMigrations } from '@siastorage/core/db/migrations'
import {
  addTagToFile as coreAddTagToFile,
  moveFileToDirectory as coreMoveFileToDirectory,
  renameDirectory as coreRenameDirectory,
  type Directory,
  type DirectoryWithCount,
  insertDirectory,
  insertFileRecord,
  queryAllDirectoriesWithCounts,
  queryAllTagsWithCounts,
  queryDirectoryNameForFile,
  queryFileRecords,
  queryLocalObjectsForFile,
  queryTagsForFile,
  queryThumbnailsByFileId,
  readFileRecord,
  renameTag,
  type Tag,
  type TagWithCount,
  updateFileRecordFields,
  upsertFsFileMetadata,
} from '@siastorage/core/db/operations'
import type { LocalObject } from '@siastorage/core/encoding/localObject'
import { ServiceScheduler } from '@siastorage/core/lib/serviceInterval'
import { syncDownEventsBatch } from '@siastorage/core/services/syncDownEvents'
import { runSyncUpMetadataBatch } from '@siastorage/core/services/syncUpMetadata'
import { ThumbnailScanner } from '@siastorage/core/services/thumbnailScanner'
import { UploadManager } from '@siastorage/core/services/uploader'
import type { FileRecord, FileRecordRow } from '@siastorage/core/types'
import { createBetterSqlite3Database } from '@siastorage/node-adapters/database'
import { createInMemoryStorage } from '@siastorage/node-adapters/storage'
import { MockSdk, type MockSdkStorage } from '@siastorage/sdk-mock'
import * as nodeFs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  buildCursorDeps,
  buildFsDeps,
  buildSyncDownDeps,
  buildSyncUpDeps,
  buildThumbnailDeps,
  buildUploadDeps,
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

export interface TestApp {
  start(): Promise<void>
  shutdown(): Promise<void>
  pause(): void
  resume(): void

  sdk: MockSdk
  db: DatabaseAdapter
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

  addFiles(fileFactories: TestFileFactory[]): Promise<TestFileInput[]>

  addTagToFile(fileId: string, tagName: string): Promise<void>
  readTagsForFile(fileId: string): Promise<Tag[]>
  readAllTagsWithCounts(): Promise<TagWithCount[]>
  renameTag(tagId: string, newName: string): Promise<void>

  createDirectory(name: string): Promise<Directory>
  moveFileToDirectory(fileId: string, dirId: string): Promise<void>
  renameDirectory(dirId: string, newName: string): Promise<void>
  readDirectoryNameForFile(fileId: string): Promise<string | undefined>
  readAllDirectoriesWithCounts(): Promise<DirectoryWithCount[]>

  updateFileRecord(
    update: Partial<FileRecordRow> & { id: string },
    opts?: { includeUpdatedAt?: boolean },
  ): Promise<void>
  readLocalObjectsForFile(fileId: string): Promise<LocalObject[]>

  removeFsFile(fileId: string, type: string): Promise<void>
  listFsFiles(): string[]
  getFsFileUri(file: { id: string; type: string }): Promise<string | null>

  setConnected(connected: boolean): void
  areServicesRunning(): boolean
}

export function createTestApp(sharedStorage: MockSdkStorage): TestApp {
  const db = createBetterSqlite3Database()
  const storage = createInMemoryStorage()
  const scheduler = new ServiceScheduler()
  const sdk = new MockSdk(sharedStorage)
  const appKey = sdk.appKey()
  const uploadManager = new UploadManager()
  const thumbnailScanner = new ThumbnailScanner()
  const uploads = new Map<string, UploadState>()
  let connected = true
  const tempDir = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'core-test-'))

  const fs = buildFsDeps({ db, tempDir })
  const cursors = buildCursorDeps(storage)

  const syncDown = scheduler.createInterval({
    name: 'syncDownEvents',
    worker: (signal) =>
      syncDownEventsBatch(
        signal,
        buildSyncDownDeps({
          db,
          sdk,
          appKey,
          indexerURL: INDEXER_URL,
          connected: () => connected,
        }),
        cursors.getSyncDownCursor,
        cursors.setSyncDownCursor,
      ),
    getState: async () => connected,
    interval: SYNC_INTERVAL,
  })

  const syncUp = scheduler.createInterval({
    name: 'syncUpMetadata',
    worker: (signal) =>
      runSyncUpMetadataBatch(
        100,
        5,
        signal,
        buildSyncUpDeps({
          db,
          sdk,
          indexerURL: INDEXER_URL,
          connected: () => connected,
        }),
        cursors.getSyncUpCursor,
        cursors.setSyncUpCursor,
      ),
    getState: async () => connected,
    interval: SYNC_INTERVAL,
  })

  const thumbScan = scheduler.createInterval({
    name: 'thumbnailScanner',
    worker: async (signal) => {
      await thumbnailScanner.runScan(signal)
    },
    getState: async () => true,
    interval: THUMBNAIL_SCAN_INTERVAL,
  })

  return {
    sdk,
    db,
    uploadManager,
    thumbnailScanner,
    tempDir,

    async start() {
      await runMigrations(db, sortMigrations(coreMigrations))
      syncDown.init()
      syncUp.init()
      uploadManager.initialize(
        buildUploadDeps({
          db,
          sdk,
          appKey,
          indexerURL: INDEXER_URL,
          connected: () => connected,
          uploads,
          getFsFileUri: fs.getFsFileUri,
        }),
      )
      thumbnailScanner.initialize(buildThumbnailDeps({ db, fs }))
      thumbScan.init()
    },

    async shutdown() {
      uploadManager.reset()
      thumbnailScanner.reset()
      await scheduler.shutdown()
      await new Promise((r) => setTimeout(r, 100))
      db.close()
      try {
        nodeFs.rmSync(tempDir, { recursive: true })
      } catch {
        // ignore cleanup errors
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
      return queryFileRecords(db, { order: 'ASC' })
    },

    async getFileById(id) {
      return readFileRecord(db, id)
    },

    async waitForFileCount(count, timeout = 15_000) {
      const start = Date.now()
      while (Date.now() - start < timeout) {
        const files = await queryFileRecords(db, { order: 'ASC' })
        if (files.length === count) return
        await new Promise((r) => setTimeout(r, 50))
      }
      const final = await queryFileRecords(db, { order: 'ASC' })
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
          const active = Array.from(uploads.values()).filter(
            (u) => u.status !== 'error',
          )
          if (active.length > 0) return false
          const pending = await queryFileRecords(db, {
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
          const state = uploads.get(fileId)
          if (status === 'removed') return state === undefined
          return state?.status === status
        },
        { timeout, message: `Upload ${fileId} to reach ${status}` },
      )
    },

    async waitForUploadCount(count, timeout = 30_000) {
      await waitForCondition(() => uploads.size === count, {
        timeout,
        message: `Upload count to be ${count}`,
      })
    },

    async waitForThumbnails(fileIds, timeout = 30_000) {
      await waitForCondition(
        async () => {
          for (const fileId of fileIds) {
            const thumbs = await queryThumbnailsByFileId(db, fileId)
            if (thumbs.length === 0) return false
          }
          return true
        },
        { timeout, message: 'Thumbnails to be generated' },
      )
    },

    getUploadState: (fileId) => uploads.get(fileId),
    getUploadCounts: () => ({ total: uploads.size }),
    getActiveUploads: () =>
      Array.from(uploads.values())
        .filter((u) => u.status !== 'error')
        .map((u) => ({ id: u.id, status: u.status })),
    getActiveUploadCount: () =>
      Array.from(uploads.values()).filter((u) => u.status !== 'error').length,

    readThumbnailsByFileId: (fileId) => queryThumbnailsByFileId(db, fileId),

    async addFiles(fileFactories) {
      const now = Date.now()
      const files: TestFileInput[] = []
      for (const factory of fileFactories) {
        const file = factory(tempDir)
        files.push(file)
        await insertFileRecord(db, {
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
        await upsertFsFileMetadata(db, {
          fileId: file.id,
          size: file.size,
          addedAt: now,
          usedAt: now,
        })
      }
      return files
    },

    async addTagToFile(fileId, tagName) {
      await coreAddTagToFile(db, fileId, tagName)
    },

    readTagsForFile: (fileId) => queryTagsForFile(db, fileId),
    readAllTagsWithCounts: () => queryAllTagsWithCounts(db),

    async renameTag(tagId, newName) {
      await renameTag(db, tagId, newName)
    },

    createDirectory: (name) => insertDirectory(db, name),

    async moveFileToDirectory(fileId, dirId) {
      await coreMoveFileToDirectory(db, fileId, dirId)
    },

    async renameDirectory(dirId, newName) {
      await coreRenameDirectory(db, dirId, newName)
    },

    readDirectoryNameForFile: (fileId) => queryDirectoryNameForFile(db, fileId),
    readAllDirectoriesWithCounts: () => queryAllDirectoriesWithCounts(db),

    updateFileRecord: (update, opts) =>
      updateFileRecordFields(db, update, opts),

    readLocalObjectsForFile: (fileId) => queryLocalObjectsForFile(db, fileId),

    async removeFsFile(fileId, type) {
      await fs.removeFsFile(fileId, type)
    },

    listFsFiles() {
      return fs.listFsFiles()
    },

    getFsFileUri: (file) => fs.getFsFileUri(file),

    setConnected(c) {
      connected = c
      sdk.setConnected(c)
    },

    areServicesRunning() {
      return !scheduler.isPaused()
    },
  }
}
