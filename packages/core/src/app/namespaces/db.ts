import type { CryptoAdapter } from '../../adapters/crypto'
import type { DatabaseAdapter } from '../../adapters/db'
import type { ThumbnailAdapter } from '../../adapters/thumbnail'
import * as ops from '../../db/operations'
import type { FsIOAdapter } from '../../services/fsFileUri'
import { getFsFileUri } from '../../services/fsFileUri'
import type { FileMetadata } from '../../types/files'
import type { AppCaches, AppService } from '../service'

function parseLogRow(row: {
  timestamp: string
  level: string
  scope: string
  message: string
  data: string | null
}) {
  let data: Record<string, unknown> | undefined
  if (row.data) {
    try {
      data = JSON.parse(row.data)
    } catch {}
  }
  return {
    timestamp: row.timestamp,
    level: row.level,
    scope: row.scope,
    message: row.message,
    data,
  }
}

/** Builds the database-backed namespaces: tags, files, directories, thumbnails, localObjects, fs, library, logs, stats. */
export function buildDbNamespaces(
  db: DatabaseAdapter,
  caches: AppCaches,
  uploads: AppService['uploads'],
  fsIO: FsIOAdapter,
  adapters?: {
    crypto?: CryptoAdapter
    thumbnail?: ThumbnailAdapter
    detectMimeType?: (path: string) => Promise<string | null>
  },
): Omit<
  AppService,
  | 'settings'
  | 'storage'
  | 'secrets'
  | 'auth'
  | 'caches'
  | 'sync'
  | 'uploads'
  | 'downloads'
  | 'connection'
  | 'init'
  | 'uploader'
  | 'hosts'
  | 'account'
  | 'optimize'
> {
  async function removeFile(file: { id: string; type: string }) {
    await fsIO.remove(file.id, file.type)
    await ops.deleteFsFileMetadata(db, file.id)
  }

  function invalidateLibrary() {
    caches.library.invalidateAll()
    caches.libraryVersion.invalidate()
  }

  const fsNamespace: AppService['fs'] = {
    readMeta: (fileId) => ops.readFsFileMetadata(db, fileId),
    upsertMeta: (row) => ops.upsertFsFileMetadata(db, row),
    deleteMeta: (fileId) => ops.deleteFsFileMetadata(db, fileId),
    deleteMetaBatch: (fileIds) => ops.deleteFsFileMetadataBatch(db, fileIds),
    updateMetaUsedAt: (fileId, usedAt) =>
      ops.updateFsFileMetadataUsedAt(db, fileId, usedAt ?? Date.now()),
    calcTotalSize: () => ops.calcFsFilesMetadataTotalSize(db),
    evictionCandidates: (thresholdUsedAt, limit) =>
      ops.queryFsCacheEvictionCandidates(db, thresholdUsedAt, limit),
    findOrphanedFileIds: (fileIds) => ops.queryOrphanedFileIds(db, fileIds),
    getFileUri: (file) => getFsFileUri(db, file, fsIO),
    removeFile,
    copyFile: async (file, sourceUri) => {
      const result = await fsIO.copy(file, sourceUri)
      const previous = await ops.readFsFileMetadata(db, file.id)
      await ops.upsertFsFileMetadata(db, {
        fileId: file.id,
        size: result.size,
        addedAt: previous?.addedAt ?? Date.now(),
        usedAt: Date.now(),
      })
      return result.uri
    },
    writeFileData: async (file, data) => {
      if (!fsIO.writeFile) throw new Error('writeFile not implemented')
      const result = await fsIO.writeFile(file, data)
      let hash = ''
      if (adapters?.crypto) {
        hash = await adapters.crypto.sha256(data)
      }
      await ops.upsertFsFileMetadata(db, {
        fileId: file.id,
        size: result.size,
        addedAt: Date.now(),
        usedAt: Date.now(),
      })
      return { uri: result.uri, size: result.size, hash }
    },
    listFiles: () => fsIO.list(),
    ensureStorageDirectory: () => fsIO.ensureDirectory(),
    detectMimeType: async (path) => {
      if (!adapters?.detectMimeType) return null
      return adapters.detectMimeType(path)
    },
  }

  return {
    tags: {
      getAll: () => ops.queryAllTagsWithCounts(db),
      getForFile: (fileId) => ops.queryTagsForFile(db, fileId),
      getNamesForFile: (fileId) => ops.queryTagNamesForFile(db, fileId),
      search: (query, limit) => ops.queryTagsByPrefix(db, query, limit ?? 10),
      isFavorite: (fileId) => ops.queryIsFavorite(db, fileId),
      add: async (fileId, tagName) => {
        await ops.addTagToFile(db, fileId, tagName)
        caches.tags.invalidateAll()
        caches.libraryVersion.invalidate()
      },
      addToFiles: async (fileIds, tagName) => {
        if (fileIds.length === 0) return
        await ops.addTagToFiles(db, fileIds, tagName)
        caches.tags.invalidateAll()
        caches.libraryVersion.invalidate()
      },
      remove: async (fileId, tagId) => {
        await ops.removeTagFromFile(db, fileId, tagId)
        caches.tags.invalidateAll()
        caches.libraryVersion.invalidate()
      },
      toggleFavorite: async (fileId) => {
        await ops.toggleFavorite(db, fileId)
        caches.tags.invalidateAll()
        caches.libraryVersion.invalidate()
      },
      rename: async (tagId, name) => {
        await ops.renameTag(db, tagId, name)
        caches.tags.invalidateAll()
        caches.libraryVersion.invalidate()
      },
      delete: async (tagId) => {
        await ops.deleteTag(db, tagId)
        caches.tags.invalidateAll()
        caches.libraryVersion.invalidate()
      },
      create: async (name) => {
        const tag = await ops.insertTag(db, name)
        caches.tags.invalidateAll()
        return tag
      },
      getOrCreate: async (name) => {
        const tag = await ops.getOrCreateTag(db, name)
        caches.tags.invalidateAll()
        return tag
      },
      ensureSystemTags: () => ops.ensureSystemTags(db),
      syncFromMetadata: async (fileId, tagNames, opts) => {
        if (tagNames === undefined) return
        await ops.syncTagsFromMetadata(db, fileId, tagNames)
        if (!opts?.skipInvalidation) {
          caches.tags.invalidateAll()
          caches.libraryVersion.invalidate()
        }
      },
      syncManyFromMetadata: async (entries, opts) => {
        await ops.syncManyTagsFromMetadata(db, entries)
        if (!opts?.skipInvalidation) {
          caches.tags.invalidateAll()
          caches.libraryVersion.invalidate()
        }
      },
    },
    files: {
      getById: (id) => ops.readFileRecord(db, id),
      getMetadata: async (id) => {
        const record = await ops.readFileRecord(db, id)
        if (!record) return null
        let metadata: FileMetadata = record
        if (record.kind === 'file') {
          const tags = await ops.queryTagNamesForFile(db, id)
          if (tags && tags.length > 0) metadata = { ...metadata, tags }
          const directory = await ops.queryDirectoryPathForFile(db, id)
          if (directory) metadata = { ...metadata, directory }
        }
        return metadata
      },
      getByIds: (ids) => ops.readFileRecordsByIds(db, ids),
      getByObjectId: (objectId, indexerURL) =>
        ops.readFileRecordByObjectId(db, objectId, indexerURL),
      getByLocalIds: (localIds) => ops.readFileRecordsByLocalIds(db, localIds),
      getByName: (name) => ops.readFileRecordByName(db, name),
      getByContentHash: (hash) => ops.readFileRecordByContentHash(db, hash),
      getByContentHashes: (hashes) => ops.readFileRecordsByContentHashes(db, hashes),
      query: (opts) => ops.queryFileRecords(db, opts),
      queryCount: (opts) => ops.queryFileRecordsCount(db, opts),
      queryStats: (opts) => ops.queryFileRecordsStats(db, opts),
      queryLibrary: (opts) => ops.queryLibraryFiles(db, opts),
      create: async (record, localObject, opts) => {
        if (localObject) {
          await ops.createFileRecordWithLocalObject(db, record, localObject)
        } else {
          await ops.insertFileRecord(db, record, {
            skipCurrentRecalc: opts?.skipCurrentRecalc,
          })
        }
        if (!opts?.skipInvalidation) {
          invalidateLibrary()
        }
      },
      createMany: async (records, opts) => {
        await ops.insertManyFileRecords(db, records, {
          conflictClause: opts?.conflictClause,
          skipCurrentRecalc: opts?.skipCurrentRecalc,
        })
        if (records.length > 0 && !opts?.skipCurrentRecalc) {
          invalidateLibrary()
        }
      },
      upsertMany: async (records, opts) => {
        await ops.upsertManyFileRecords(db, records, {
          skipCurrentRecalc: opts?.skipCurrentRecalc,
        })
        if (records.length > 0 && !opts?.skipCurrentRecalc) {
          invalidateLibrary()
        }
      },
      getRowsByIds: (ids) => ops.queryFileRecordRowsByIds(db, ids),
      getRowsByObjectIds: (objectIds, indexerURL) =>
        ops.queryFileRecordRowsByObjectIds(db, objectIds, indexerURL),
      tombstone: async (fileIds, opts) => {
        await ops.tombstoneFileRecords(db, fileIds, Date.now())
        if (!opts?.skipInvalidation) {
          invalidateLibrary()
        }
      },
      update: async (update, opts) => {
        await ops.updateFileRecordFields(db, update, {
          includeUpdatedAt: opts?.includeUpdatedAt,
          skipCurrentRecalc: opts?.skipCurrentRecalc,
        })
        if (!opts?.skipInvalidation) {
          caches.fileById.invalidate(update.id)
          caches.libraryVersion.invalidate()
        }
      },
      updateMany: async (updates, opts) => {
        await ops.updateManyFileRecordFields(db, updates, {
          includeUpdatedAt: opts?.includeUpdatedAt,
          skipCurrentRecalc: opts?.skipCurrentRecalc,
        })
        if (updates.length > 0) {
          for (const u of updates) {
            caches.fileById.invalidate(u.id)
          }
          caches.libraryVersion.invalidate()
        }
      },
      updateWithLocalObject: async (update, localObject, opts) => {
        await ops.updateFileRecordWithLocalObject(db, update, localObject, opts)
        if (!opts?.skipInvalidation) {
          caches.fileById.invalidate(update.id)
          await caches.library.invalidateAll()
          caches.libraryVersion.invalidate()
        }
      },
      delete: async (id, opts) => {
        await ops.deleteFileRecordById(db, id)
        if (!opts?.skipInvalidation) {
          invalidateLibrary()
        }
      },
      deleteMany: async (ids) => {
        await ops.deleteManyFileRecordsByIds(db, ids)
        if (ids.length > 0) {
          invalidateLibrary()
        }
      },
      deleteAll: async () => {
        await ops.deleteAllFileRecords(db)
      },
      deleteAndThumbnails: async (id) => {
        await ops.deleteFileRecordAndThumbnails(db, id)
        invalidateLibrary()
      },
      deleteManyAndThumbnails: async (ids) => {
        await ops.deleteFileRecordsAndThumbnails(db, ids)
        invalidateLibrary()
      },
      recalculateCurrent: (fileIds) => ops.recalculateCurrentForFileIds(db, fileIds),
      recalculateCurrentForGroups: (groups) => ops.recalculateCurrentForGroups(db, groups),
      deleteLost: async (indexerURL) => {
        const lostIds = await ops.deleteLostFiles(db, indexerURL)
        if (lostIds.length > 0) {
          invalidateLibrary()
        }
        return lostIds
      },
      trash: async (ids) => {
        await ops.trashFiles(db, ids)
        uploads.removeMany(ids)
        invalidateLibrary()
      },
      restore: async (ids) => {
        await ops.restoreFiles(db, ids)
        invalidateLibrary()
      },
      getLostCount: (indexerURL) => ops.queryLostFileCount(db, indexerURL),
      getLostStats: (indexerURL) => ops.queryLostFileStats(db, indexerURL),
      getUnuploadedCount: () => ops.queryUnuploadedFileCount(db),
      getUnuploaded: () => ops.queryUnuploadedFiles(db),
      getActiveSummaries: () => ops.queryActiveFileSummaries(db),
      getUploadedIds: (url) => ops.queryUploadedFileIds(db, url),
      autoPurge: () => ops.autoPurgeOldTrashedFiles(db),
      permanentlyDelete: async (ids) => {
        await ops.permanentlyDeleteFiles(db, ids)
        invalidateLibrary()
      },
      permanentlyDeleteWithCleanup: async (files) => {
        if (files.length === 0) return
        const ids = files.map((f) => f.id)
        uploads.removeMany(ids)
        await ops.permanentlyDeleteFiles(db, ids)
        const thumbs = await ops.queryThumbnailFileInfoByFileIds(db, ids)
        await Promise.all([...files, ...thumbs].map((f) => fsNamespace.removeFile(f)))
        invalidateLibrary()
      },
      autoPurgeWithCleanup: async () => {
        const purgedIds = await ops.autoPurgeOldTrashedFiles(db)
        if (purgedIds.length === 0) return
        const files = await ops.readFileRecordsByIds(db, purgedIds)
        if (files.length === 0) return
        uploads.removeMany(purgedIds)
        const thumbs = await ops.queryThumbnailFileInfoByFileIds(db, purgedIds)
        await Promise.all([...files, ...thumbs].map((f) => fsNamespace.removeFile(f)))
        invalidateLibrary()
      },
      getVersionHistory: async (name, directoryId) => {
        const rows = await ops.queryFileVersions(db, name, directoryId)
        return rows.map((r) => ops.transformRow(r))
      },
      renameFile: async (id, newName) => {
        const file = await db.getFirstAsync<{
          name: string
          directoryId: string | null
        }>('SELECT name, directoryId FROM files WHERE id = ?', id)
        if (!file) return
        await ops.renameAllFileVersions(db, file.name, file.directoryId, newName)
        invalidateLibrary()
      },
      moveFile: async (id, dirId) => {
        const file = await db.getFirstAsync<{
          name: string
          directoryId: string | null
        }>('SELECT name, directoryId FROM files WHERE id = ?', id)
        if (!file) return
        await ops.moveAllFileVersions(db, file.name, file.directoryId, dirId)
        caches.directories.invalidateAll()
        invalidateLibrary()
      },
      trashFile: async (id) => {
        const file = await db.getFirstAsync<{
          name: string
          directoryId: string | null
        }>('SELECT name, directoryId FROM files WHERE id = ?', id)
        if (!file) return
        const ids = await ops.trashAllFileVersions(db, file.name, file.directoryId)
        uploads.removeMany(ids)
        invalidateLibrary()
      },
      trashAllVersions: async (name, directoryId) => {
        const ids = await ops.trashAllFileVersions(db, name, directoryId)
        if (ids.length > 0) {
          invalidateLibrary()
        }
        return ids
      },
    },
    directories: {
      getAll: () => ops.queryAllDirectoriesWithCounts(db),
      getById: (id) => ops.queryDirectoryById(db, id),
      getByPath: (path) => ops.queryDirectoryByPath(db, path),
      getPathForFile: (fileId) => ops.queryDirectoryPathForFile(db, fileId),
      getChildren: (parentPath) => ops.queryDirectoryChildren(db, parentPath),
      create: async (name, parentPath) => {
        const dir = await ops.insertDirectory(db, name, parentPath)
        caches.directories.invalidateAll()
        return dir
      },
      getOrCreate: (name, parentPath) => ops.getOrCreateDirectory(db, name, parentPath),
      getOrCreateAtPath: (path) => ops.getOrCreateDirectoryAtPath(db, path),
      delete: async (id) => {
        await ops.deleteDirectory(db, id)
        caches.directories.invalidateAll()
        caches.libraryVersion.invalidate()
      },
      deleteAndTrashFiles: async (id) => {
        const fileIds = await ops.deleteDirectoryAndTrashFiles(db, id)
        caches.directories.invalidateAll()
        await caches.library.invalidateAll()
        caches.libraryVersion.invalidate()
        return fileIds
      },
      rename: async (id, name) => {
        const dir = await ops.renameDirectory(db, id, name)
        caches.directories.invalidateAll()
        caches.libraryVersion.invalidate()
        return dir
      },
      moveDirectory: async (directoryId, newParentPath) => {
        await ops.moveDirectory(db, directoryId, newParentPath)
        caches.directories.invalidateAll()
        caches.libraryVersion.invalidate()
      },
      moveFile: async (fileId, dirId) => {
        await ops.moveFileToDirectory(db, fileId, dirId)
        caches.directories.invalidateAll()
        caches.directories.invalidate(`file/${fileId}`)
        caches.libraryVersion.invalidate()
      },
      moveFiles: async (fileIds, dirId) => {
        await ops.moveFilesToDirectory(db, fileIds, dirId)
        caches.directories.invalidateAll()
        for (const id of fileIds) {
          caches.directories.invalidate(`file/${id}`)
        }
        caches.libraryVersion.invalidate()
      },
      countFilesWithDirectories: (fileIds) => ops.queryCountFilesWithDirectories(db, fileIds),
      syncFromMetadata: async (fileId, dirPath, opts) => {
        if (dirPath === undefined) return
        await ops.syncDirectoryFromMetadata(db, fileId, dirPath, {
          skipCurrentRecalc: opts?.skipCurrentRecalc,
        })
        if (!opts?.skipInvalidation) {
          caches.directories.invalidateAll()
          caches.directories.invalidate(`file/${fileId}`)
          caches.libraryVersion.invalidate()
        }
      },
      syncManyFromMetadata: async (entries, opts) => {
        const oldGroups = await ops.syncManyDirectoriesFromMetadata(db, entries)
        if (!opts?.skipInvalidation) {
          caches.directories.invalidateAll()
          caches.libraryVersion.invalidate()
        }
        return oldGroups
      },
    },
    thumbnails: {
      getForFile: (fileId) => ops.queryThumbnailsByFileId(db, fileId),
      getBest: (fileId, requiredSize) => ops.queryBestThumbnailByFileId(db, fileId, requiredSize),
      getByFileIdAndSize: (fileId, size) =>
        ops.queryThumbnailRecordByFileIdAndSize(db, fileId, size),
      getInfoForFiles: (fileIds) => ops.queryThumbnailFileInfoByFileIds(db, fileIds),
      getSizesForFile: (fileId) => ops.queryThumbnailSizesForFileId(db, fileId),
      existsForFileAndSize: (fileId, size) =>
        ops.queryThumbnailExistsForFileIdAndSize(db, fileId, size),
      queryCandidatePage: (pageSize, cursor) =>
        ops.queryThumbnailCandidatePage(db, pageSize, cursor),
      queryProgress: () => ops.queryThumbnailScanProgress(db),
      generate: (sourcePath, targetSize) => {
        if (!adapters?.thumbnail) throw new Error('Thumbnail adapter not configured')
        return adapters.thumbnail.generateImageThumbnail(sourcePath, targetSize)
      },
      generateBatch: (sourcePath, sizes) => {
        if (!adapters?.thumbnail) throw new Error('Thumbnail adapter not configured')
        return adapters.thumbnail.generateImageThumbnails(sourcePath, sizes)
      },
      generateVideo: (sourcePath, targetSize) => {
        if (!adapters?.thumbnail) throw new Error('Thumbnail adapter not configured')
        return adapters.thumbnail.generateVideoThumbnail(sourcePath, targetSize)
      },
    },
    localObjects: {
      getForFile: (fileId) => ops.queryLocalObjectsForFile(db, fileId),
      getForFiles: (fileIds) => ops.queryLocalObjectsForFiles(db, fileIds),
      upsert: async (object, opts) => {
        await ops.insertLocalObject(db, object)
        if (!opts?.skipInvalidation) {
          await caches.library.invalidateAll()
          caches.libraryVersion.invalidate()
        }
      },
      delete: async (objectId, indexerURL, opts) => {
        await ops.deleteLocalObjectById(db, objectId, indexerURL)
        if (!opts?.skipInvalidation) {
          await caches.library.invalidateAll()
          caches.libraryVersion.invalidate()
        }
      },
      deleteForFile: async (fileId, opts) => {
        await ops.deleteLocalObjectsByFileId(db, fileId)
        if (!opts?.skipInvalidation) {
          await caches.library.invalidateAll()
          caches.libraryVersion.invalidate()
        }
      },
      deleteManyForFiles: async (fileIds) => {
        if (fileIds.length === 0) return
        await ops.deleteManyLocalObjectsByFileIds(db, fileIds)
        await caches.library.invalidateAll()
        caches.libraryVersion.invalidate()
      },
      upsertMany: async (objects, opts) => {
        await ops.insertManyLocalObjects(db, objects)
        if (!opts?.skipInvalidation) {
          await caches.library.invalidateAll()
          caches.libraryVersion.invalidate()
        }
      },
      countForFile: (fileId) => ops.countLocalObjectsForFile(db, fileId),
      deleteManyByObjectIds: async (objectIds, indexerURL, opts) => {
        await ops.deleteManyLocalObjectsByObjectIds(db, objectIds, indexerURL)
        if (!opts?.skipInvalidation) {
          await caches.library.invalidateAll()
          caches.libraryVersion.invalidate()
        }
      },
      queryFilesWithNoObjects: (fileIds) => ops.queryFilesWithNoObjects(db, fileIds),
    },
    fs: fsNamespace,
    library: {
      fileCount: () => ops.queryLibraryFileCount(db),
      mediaCount: () => ops.queryMediaFileCount(db),
      tagFileCount: (tagId) => ops.queryTagFileCount(db, tagId),
      directoryFileCount: (directoryId) => ops.queryDirectoryFileCount(db, directoryId),
      unfiledFileCount: () => ops.queryUnfiledFileCount(db),
      countWithFilters: (opts) => ops.queryFileCountWithFilters(db, opts),
      filePosition: (fileId, params) =>
        ops.queryFilePositionInSortedList(db, fileId, {
          ...params,
          sortBy: params.sortBy ?? 'DATE',
          sortDir: params.sortDir ?? 'DESC',
        }),
      sortedFileIds: (params, limit, offset) => ops.querySortedFileIds(db, params, limit, offset),
    },
    logs: {
      append: (entry) => ops.insertLog(db, { ...entry, createdAt: Date.now() }),
      appendMany: (entries) =>
        ops.insertManyLogs(
          db,
          entries.map((e) => ({ ...e, createdAt: Date.now() })),
        ),
      read: async (opts?: { logLevel?: string; logScopes?: string[]; limit?: number }) => {
        const rows = await ops.queryLogs(db, opts as Parameters<typeof ops.queryLogs>[1])
        return rows.map(parseLogRow)
      },
      count: (opts?: { logLevel?: string; logScopes?: string[] }) =>
        ops.queryLogCount(db, opts as Parameters<typeof ops.queryLogCount>[1]),
      clear: () => ops.deleteAllLogs(db),
      rotate: (maxLogs) => ops.rotateLogs(db, maxLogs),
      availableScopes: () => ops.queryAvailableLogScopes(db),
    },
    stats: {
      uploadStats: (indexerURL) => ops.queryUploadStats(db, indexerURL),
    },
  }
}
