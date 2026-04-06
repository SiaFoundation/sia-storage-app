import type { Account, Host, ObjectsCursor, SdkAdapter } from '../adapters/sdk'
import type {
  Directory,
  DirectoryWithCount,
  FileRecordsQueryOpts,
  FsMetaRow,
  LibraryQueryParams,
  Tag,
  TagWithCount,
  UploadStats,
} from '../db/operations'
import type { LocalObject } from '../encoding/localObject'
import type { SyncUpCursor } from '../services/syncUpMetadata'
import type { FileRecord, FileRecordRow, ThumbSize } from '../types/files'
import type {
  ConnectionState,
  DownloadEntry,
  DownloadsState,
  InitState,
  InitStep,
  SyncState,
  UploadEntry,
  UploadStatus,
  UploadsState,
} from './stores'

/** SWR cache helpers for a single cache namespace, parameterized by optional key parts. */
export type SwrCacheBy<T = unknown> = {
  /** Builds the SWR key array for the given key parts. */
  key: (...parts: string[]) => string[]
  /** Invalidates the cached entry matching the given key parts. */
  invalidate: (...parts: string[]) => Promise<any>
  /** Invalidates all entries in this cache namespace. */
  invalidateAll: () => Promise<any>
  /** Directly sets the cached data for the given key parts. */
  set: (data: T, ...parts: string[]) => Promise<any>
}

/** Cache that tracks library data version changes via a monotonic counter. */
export interface LibraryVersionCache {
  /** Bumps the version number, signaling that library data has changed. */
  invalidate(): void
  /** Subscribes to version changes; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void
  /** Returns the current version number. */
  getVersion(): number
}

/** All SWR caches used by the app, keyed by domain. */
export interface AppCaches {
  tags: SwrCacheBy
  directories: SwrCacheBy
  library: SwrCacheBy
  fileById: SwrCacheBy
  thumbnails: {
    best: SwrCacheBy
    byFileId: SwrCacheBy
  }
  libraryVersion: LibraryVersionCache
  settings: SwrCacheBy
  sync: SwrCacheBy
  uploads: SwrCacheBy
  downloads: SwrCacheBy
  connection: SwrCacheBy
  init: SwrCacheBy
  sdk: SwrCacheBy
  hosts: SwrCacheBy
}

/** Primary API contract for all platform apps. All state and mutations flow through this facade. */
export interface AppService {
  /** Runs PRAGMA optimize to refresh query planner statistics for tables with stale stats. */
  optimize(): Promise<void>
  /** Tag operations: create, query, and manage file tags. */
  tags: {
    /** Returns all tags with their associated file counts. */
    getAll(): Promise<TagWithCount[]>
    /** Returns all tags assigned to a file. */
    getForFile(fileId: string): Promise<Tag[]>
    /** Returns tag names for a file, or undefined if the file has no tags. */
    getNamesForFile(fileId: string): Promise<string[] | undefined>
    /** Searches tags by name prefix. */
    search(query: string, limit?: number): Promise<Tag[]>
    /** Returns whether a file is tagged as a favorite. */
    isFavorite(fileId: string): Promise<boolean>
    /** Adds a tag (by name) to a file, creating the tag if needed. */
    add(fileId: string, tagName: string): Promise<void>
    /** Adds a tag (by name) to multiple files. */
    addToFiles(fileIds: string[], tagName: string): Promise<void>
    /** Removes a tag assignment from a file. */
    remove(fileId: string, tagId: string): Promise<void>
    /** Toggles the favorite tag on a file. */
    toggleFavorite(fileId: string): Promise<void>
    /** Renames an existing tag. */
    rename(tagId: string, name: string): Promise<void>
    /** Deletes a tag and all its file assignments. */
    delete(tagId: string): Promise<void>
    /** Creates a new tag with the given name. */
    create(name: string): Promise<Tag>
    /** Returns an existing tag by name, or creates one if it does not exist. */
    getOrCreate(name: string): Promise<Tag>
    /** Ensures built-in system tags (e.g., favorites) exist. */
    ensureSystemTags(): Promise<void>
    /** Reconciles a file's tags with the given metadata tag names. */
    syncFromMetadata(
      fileId: string,
      tagNames: string[] | undefined,
      opts?: { skipInvalidation?: boolean },
    ): Promise<void>
    /** Batch reconciles tags from metadata for multiple files. */
    syncManyFromMetadata(
      entries: { fileId: string; tagNames: string[] }[],
      opts?: { skipInvalidation?: boolean },
    ): Promise<void>
  }
  /** File record CRUD, queries, trash, and purge operations. */
  files: {
    /** Returns a file record by its ID, or null if not found. */
    getById(id: string): Promise<FileRecord | null>
    /** Returns file records for the given IDs. */
    getByIds(ids: string[]): Promise<FileRecord[]>
    /** Returns a file record matching a remote object ID and indexer URL. */
    getByObjectId(
      objectId: string,
      indexerURL: string,
    ): Promise<FileRecord | null>
    /** Returns file records matching the given local IDs. */
    getByLocalIds(localIds: string[]): Promise<FileRecord[]>
    /** Returns a file record by exact name match. */
    getByName(name: string): Promise<FileRecord | null>
    /** Returns a file record by content hash. */
    getByContentHash(hash: string): Promise<FileRecord | null>
    /** Returns file records matching any of the given content hashes. */
    getByContentHashes(hashes: string[]): Promise<FileRecord[]>
    /** Queries file records with filtering, sorting, and pagination. */
    query(opts: FileRecordsQueryOpts): Promise<FileRecord[]>
    /** Returns the count of file records matching the query. */
    queryCount(opts: FileRecordsQueryOpts): Promise<number>
    /** Returns count and total byte size for file records matching the query. */
    queryStats(
      opts: FileRecordsQueryOpts,
    ): Promise<{ count: number; totalBytes: number }>
    /** Queries raw file record rows for library display with pagination. */
    queryLibrary(
      opts: LibraryQueryParams & { limit?: number; offset?: number },
    ): Promise<FileRecordRow[]>
    /** Creates a new file record, optionally with a local object reference. */
    create(
      record: Omit<FileRecord, 'objects'>,
      localObject?: LocalObject,
      opts?: { skipInvalidation?: boolean; skipCurrentRecalc?: boolean },
    ): Promise<void>
    /** Creates multiple file records via bulk insert. Pass conflictClause
     * 'OR IGNORE' to silently skip duplicates (e.g. localId conflicts). */
    createMany(
      records: Omit<FileRecord, 'objects'>[],
      opts?: { conflictClause?: 'OR IGNORE'; skipCurrentRecalc?: boolean },
    ): Promise<void>
    /** Bulk upsert file records. Creates new rows, updates existing rows' metadata
     * fields (name, size, type, etc.) while preserving addedAt, localId, deletedAt. */
    upsertMany(
      records: Omit<FileRecord, 'objects'>[],
      opts?: { skipCurrentRecalc?: boolean },
    ): Promise<void>
    /** Returns file record rows by IDs (no objects join). */
    getRowsByIds(ids: string[]): Promise<Map<string, FileRecordRow>>
    /** Returns file record rows by object IDs and indexer URL (no objects join). */
    getRowsByObjectIds(
      objectIds: string[],
      indexerURL: string,
    ): Promise<Map<string, FileRecordRow>>
    /** Batch tombstone: sets deletedAt and trashedAt on multiple files. */
    tombstone(
      fileIds: string[],
      opts?: { skipInvalidation?: boolean },
    ): Promise<void>
    /** Partially updates a file record by ID. */
    update(
      update: Partial<FileRecordRow> & { id: string },
      opts?: {
        includeUpdatedAt?: boolean
        skipInvalidation?: boolean
        skipCurrentRecalc?: boolean
      },
    ): Promise<void>
    /** Partially updates multiple file records in a single transaction. */
    updateMany(
      updates: (Partial<FileRecordRow> & { id: string })[],
      opts?: {
        includeUpdatedAt?: boolean
        skipCurrentRecalc?: boolean
      },
    ): Promise<void>
    /** Updates a file record and upserts its local object in one operation. */
    updateWithLocalObject(
      update: Partial<FileRecordRow> & { id: string },
      localObject: LocalObject,
      opts?: { includeUpdatedAt?: boolean; skipInvalidation?: boolean },
    ): Promise<void>
    /** Soft-deletes a file record (tombstone). */
    delete(id: string, opts?: { skipInvalidation?: boolean }): Promise<void>
    /** Soft-deletes multiple file records. */
    deleteMany(ids: string[]): Promise<void>
    /** Soft-deletes all file records. */
    deleteAll(): Promise<void>
    /** Soft-deletes a file and all its associated thumbnails. */
    deleteAndThumbnails(id: string): Promise<void>
    /** Soft-deletes multiple files and all their associated thumbnails. */
    deleteManyAndThumbnails(ids: string[]): Promise<void>
    /** Deletes files that have no remaining remote objects on the given indexer. */
    deleteLost(indexerURL: string): Promise<string[]>
    /** Recalculates the current column for all version groups containing the given file IDs. */
    recalculateCurrent(fileIds: string[]): Promise<void>
    /** Recalculates the current column for the given version groups. */
    recalculateCurrentForGroups(
      groups: { name: string; directoryId: string | null }[],
    ): Promise<void>
    /** Moves files to the trash. */
    trash(ids: string[]): Promise<void>
    /** Restores files from the trash. */
    restore(ids: string[]): Promise<void>
    /** Returns the count of files that have not yet been uploaded. */
    getUnuploadedCount(): Promise<number>
    /** Returns summary info for files that have not yet been uploaded. */
    getUnuploaded(): Promise<
      { id: string; name: string; type: string; size: number }[]
    >
    /** Returns summary info for all active (non-trashed, non-deleted) files. */
    getActiveSummaries(): Promise<
      { id: string; kind: string; type: string; size: number }[]
    >
    /** Returns IDs of files that have been uploaded to the given indexer. */
    getUploadedIds(indexerUrl: string): Promise<string[]>
    /** Permanently deletes files past the trash retention period. */
    autoPurge(): Promise<string[]>
    /** Permanently deletes file records by ID (hard delete). */
    permanentlyDelete(ids: string[]): Promise<void>
    /** Permanently deletes files and cleans up local files and uploads. */
    permanentlyDeleteWithCleanup(
      files: { id: string; type: string; localId: string | null }[],
    ): Promise<void>
    /** Runs auto-purge and cleans up local files and uploads for purged files. */
    autoPurgeWithCleanup(): Promise<void>
    /** Returns the count of lost files for the given indexer. */
    getLostCount(indexerURL: string): Promise<number>
    /** Returns count and total byte size of lost files for the given indexer. */
    getLostStats(
      indexerURL: string,
    ): Promise<{ count: number; totalBytes: number }>
    /** Returns all versions of a file (same name + directory), ordered by updatedAt DESC. */
    getVersionHistory(
      name: string,
      directoryId: string | null,
    ): Promise<FileRecord[]>
    /** Renames all versions of a file. Merges into target group if it exists. */
    renameFile(id: string, newName: string): Promise<void>
    /** Moves all versions of a file to a directory. Merges into target group if it exists. */
    moveFile(id: string, dirId: string | null): Promise<void>
    /** Trashes all versions of a file by looking up its version group from the file ID. */
    trashFile(id: string): Promise<void>
    /** Trashes all versions of a file (same name + directory). */
    trashAllVersions(
      name: string,
      directoryId: string | null,
    ): Promise<string[]>
  }
  /** Directory operations: create, rename, delete, move, and organize files into directories. */
  directories: {
    /** Returns all directories with their file and subdirectory counts. */
    getAll(): Promise<DirectoryWithCount[]>
    /** Returns a directory by ID. */
    getById(id: string): Promise<Directory | null>
    /** Returns a directory by exact path match. */
    getByPath(path: string): Promise<Directory | null>
    /** Returns the directory path for a file, or undefined if unfiled. */
    getPathForFile(fileId: string): Promise<string | undefined>
    /** Returns direct children of a directory (null for root). */
    getChildren(parentPath: string | null): Promise<DirectoryWithCount[]>
    /** Creates a new directory, optionally under a parent path. */
    create(name: string, parentPath?: string): Promise<Directory>
    /** Returns an existing directory by name, or creates one if it does not exist. */
    getOrCreate(name: string, parentPath?: string): Promise<Directory>
    /** Creates all intermediate directories for a path and returns the leaf. */
    getOrCreateAtPath(path: string): Promise<Directory>
    /** Deletes a directory and all descendants without affecting files. */
    delete(id: string): Promise<void>
    /** Deletes a directory, all descendants, and trashes their files. */
    deleteAndTrashFiles(id: string): Promise<string[]>
    /** Renames a directory and updates all descendant paths. Returns the updated directory. */
    rename(id: string, name: string): Promise<Directory>
    /** Moves a directory under a new parent (null for root). */
    moveDirectory(
      directoryId: string,
      newParentPath: string | null,
    ): Promise<void>
    /** Moves a file into a directory, or removes it from all directories if null. */
    moveFile(fileId: string, dirId: string | null): Promise<void>
    /** Moves multiple files into a directory. */
    moveFiles(fileIds: string[], dirId: string | null): Promise<void>
    /** Returns how many of the given files belong to a directory. */
    countFilesWithDirectories(fileIds: string[]): Promise<number>
    /** Reconciles a file's directory assignment with metadata. */
    syncFromMetadata(
      fileId: string,
      dirPath: string | undefined,
      opts?: { skipInvalidation?: boolean; skipCurrentRecalc?: boolean },
    ): Promise<void>
    /** Batch reconciles directory assignments from metadata. Returns old version groups for recalculation. */
    syncManyFromMetadata(
      entries: { fileId: string; directoryPath: string }[],
      opts?: { skipInvalidation?: boolean },
    ): Promise<{ name: string; directoryId: string | null }[]>
  }
  /** Thumbnail queries and generation. */
  thumbnails: {
    /** Returns all thumbnail records for a file. */
    getForFile(fileId: string): Promise<FileRecord[]>
    /** Returns the best available thumbnail at or above the required size. */
    getBest(fileId: string, requiredSize: ThumbSize): Promise<FileRecord | null>
    /** Returns a thumbnail for a specific file and size combination. */
    getByFileIdAndSize(
      fileId: string,
      size: ThumbSize,
    ): Promise<FileRecord | null>
    /** Returns thumbnail info (id, type, localId) for multiple files. */
    getInfoForFiles(
      fileIds: string[],
    ): Promise<{ id: string; type: string; localId: string | null }[]>
    /** Returns all available thumbnail sizes for a file. */
    getSizesForFile(fileId: string): Promise<ThumbSize[]>
    /** Returns whether a thumbnail exists for a given file and size. */
    existsForFileAndSize(fileId: string, size: ThumbSize): Promise<boolean>
    /** Returns a page of candidate originals that still need thumbnails generated. */
    queryCandidatePage(
      pageSize: number,
      cursor?: { createdAt: number; id: string },
    ): Promise<
      {
        id: string
        hash: string
        type: string
        localId: string | null
        createdAt: number
      }[]
    >
    /** Returns overall thumbnail scan progress (count of originals and thumbs). */
    queryProgress(): Promise<{ originals: number; thumbs: number }>
    /** Generates a single image thumbnail at the given size. */
    generate(
      sourcePath: string,
      targetSize: number,
    ): Promise<{ data: ArrayBuffer; mimeType: string }>
    /** Generates image thumbnails at multiple sizes in one pass. */
    generateBatch(
      sourcePath: string,
      sizes: number[],
    ): Promise<Map<number, { data: ArrayBuffer; mimeType: string }>>
    /** Generates a video thumbnail at the given size. */
    generateVideo(
      sourcePath: string,
      targetSize: number,
    ): Promise<{ data: ArrayBuffer; mimeType: string }>
  }
  /** Local object (remote reference) CRUD for file-to-indexer mappings. */
  localObjects: {
    /** Returns all local objects for a file. */
    getForFile(fileId: string): Promise<LocalObject[]>
    /** Returns local objects for multiple files, keyed by file ID. */
    getForFiles(fileIds: string[]): Promise<Record<string, LocalObject[]>>
    /** Creates or updates a local object reference. */
    upsert(
      object: LocalObject,
      opts?: { skipInvalidation?: boolean },
    ): Promise<void>
    /** Deletes a specific local object by its object ID and indexer URL. */
    delete(
      objectId: string,
      indexerURL: string,
      opts?: { skipInvalidation?: boolean },
    ): Promise<void>
    /** Deletes all local objects for a file. */
    deleteForFile(
      fileId: string,
      opts?: { skipInvalidation?: boolean },
    ): Promise<void>
    /** Deletes all local objects for multiple files. */
    deleteManyForFiles(fileIds: string[]): Promise<void>
    /** Creates or updates multiple local objects in a single transaction. */
    upsertMany(
      objects: LocalObject[],
      opts?: { skipInvalidation?: boolean },
    ): Promise<void>
    /** Returns the number of local objects for a file. */
    countForFile(fileId: string): Promise<number>
    /** Batch deletes local objects by their object IDs for a given indexer. */
    deleteManyByObjectIds(
      objectIds: string[],
      indexerURL: string,
      opts?: { skipInvalidation?: boolean },
    ): Promise<void>
    /** Returns file IDs that have no remaining objects. */
    queryFilesWithNoObjects(fileIds: string[]): Promise<string[]>
  }
  /** Local file system operations: metadata tracking, caching, and file I/O. */
  fs: {
    /** Reads the file system metadata row for a file. */
    readMeta(fileId: string): Promise<FsMetaRow | null>
    /** Creates or updates file system metadata for a file. */
    upsertMeta(row: FsMetaRow): Promise<void>
    /** Deletes file system metadata for a file. */
    deleteMeta(fileId: string): Promise<void>
    /** Deletes file system metadata for multiple files. */
    deleteMetaBatch(fileIds: string[]): Promise<void>
    /** Updates the last-used timestamp for a file. */
    updateMetaUsedAt(fileId: string, usedAt?: number): Promise<void>
    /** Returns the total size in bytes of all tracked local files. */
    calcTotalSize(): Promise<number>
    /** Returns files eligible for eviction, ordered by least recently used. */
    evictionCandidates(
      thresholdUsedAt: number,
      limit: number,
    ): Promise<{ fileId: string; size: number; type: string }[]>
    /** Returns the subset of fileIds that are orphaned (no fs row or soft-deleted). */
    findOrphanedFileIds(fileIds: string[]): Promise<Set<string>>
    /** Returns the local file URI if the file exists on disk, or null. */
    getFileUri(file: { id: string; type: string }): Promise<string | null>
    /** Removes a local file from disk. */
    removeFile(file: { id: string; type: string }): Promise<void>
    /** Copies a file from the source URI into managed storage; returns the new URI. */
    copyFile(
      file: { id: string; type: string },
      sourceUri: string,
    ): Promise<string>
    /** Writes file data to managed storage, computes hash, and upserts metadata. */
    writeFileData(
      file: { id: string; type: string },
      data: ArrayBuffer,
    ): Promise<{ uri: string; size: number; hash: string }>
    /** Detects the MIME type of a file at the given path. */
    detectMimeType(path: string): Promise<string | null>
    /** Lists all filenames in the managed storage directory. */
    listFiles(): Promise<string[]>
    /** Creates the managed storage directory if it does not exist. */
    ensureStorageDirectory(): Promise<void>
  }
  /** Library aggregate queries: counts, positions, and sorted ID lists. */
  library: {
    /** Returns the total number of active files. */
    fileCount(): Promise<number>
    /** Returns the total number of active media files. */
    mediaCount(): Promise<number>
    /** Returns the number of files with the given tag. */
    tagFileCount(tagId: string): Promise<number>
    /** Returns the number of files in the given directory. */
    directoryFileCount(directoryId: string): Promise<number>
    /** Returns the number of files not in any directory. */
    unfiledFileCount(): Promise<number>
    /** Returns the file count matching the given filter params. */
    countWithFilters(opts: LibraryQueryParams): Promise<number>
    /** Returns the 0-based position of a file in the sorted library. */
    filePosition(fileId: string, params: LibraryQueryParams): Promise<number>
    /** Returns a page of file IDs sorted according to the given params. */
    sortedFileIds(
      params: LibraryQueryParams,
      limit: number,
      offset: number,
    ): Promise<string[]>
  }
  /** Structured log storage: append, query, rotate, and clear logs. */
  logs: {
    /** Appends a log entry to the database. */
    append(entry: {
      timestamp: string
      level: string
      scope: string
      message: string
      data: string | null
    }): Promise<void>
    /** Appends multiple log entries in a single transaction. */
    appendMany(
      entries: {
        timestamp: string
        level: string
        scope: string
        message: string
        data: string | null
      }[],
    ): Promise<void>
    /** Reads log entries with optional level, scope, and limit filters. */
    read(opts?: {
      logLevel?: string
      logScopes?: string[]
      limit?: number
    }): Promise<any[]>
    /** Returns the count of log entries matching the filters. */
    count(opts?: { logLevel?: string; logScopes?: string[] }): Promise<number>
    /** Deletes all log entries. */
    clear(): Promise<void>
    /** Deletes the oldest entries, keeping at most maxLogs; returns number deleted. */
    rotate(maxLogs: number): Promise<number>
    /** Returns all distinct log scopes present in the database. */
    availableScopes(): Promise<string[]>
  }
  /** Upload statistics queries. */
  stats: {
    /** Returns upload counts and byte totals for the given indexer. */
    uploadStats(indexerURL: string): Promise<UploadStats>
  }
  /** Persistent user settings: get and set typed configuration values. */
  settings: {
    /** Returns the configured indexer URL. */
    getIndexerURL(): Promise<string>
    /** Sets the indexer URL. */
    setIndexerURL(value: string): Promise<void>
    /** Returns whether the user has completed onboarding. */
    getHasOnboarded(): Promise<boolean>
    /** Sets the onboarding completion flag. */
    setHasOnboarded(value: boolean): Promise<void>
    /** Returns the last completed forced reset version, or empty string if none. */
    getCompletedResetVersion(): Promise<string>
    /** Records a completed forced reset version so it won't trigger again. */
    setCompletedResetVersion(version: string): Promise<void>
    /** Returns whether advanced settings are visible. */
    getShowAdvanced(): Promise<boolean>
    /** Sets the advanced settings visibility flag. */
    setShowAdvanced(value: boolean): Promise<void>
    /** Returns whether auto-scan uploads is enabled. */
    getAutoScanUploads(): Promise<boolean>
    /** Sets the auto-scan uploads flag. */
    setAutoScanUploads(value: boolean): Promise<void>
    /** Returns whether automatic sync-down of events is enabled. */
    getAutoSyncDownEvents(): Promise<boolean>
    /** Sets the auto sync-down events flag. */
    setAutoSyncDownEvents(value: boolean): Promise<void>
    /** Returns the current status display mode. */
    getStatusDisplayMode(): Promise<string>
    /** Sets the status display mode. */
    setStatusDisplayMode(value: string): Promise<void>
    /** Returns the directory used for photo imports. */
    getPhotoImportDirectory(): Promise<string>
    /** Sets the photo import directory. */
    setPhotoImportDirectory(value: string): Promise<void>
    /** Returns the currently active library tab. */
    getActiveLibraryTab(): Promise<string>
    /** Sets the active library tab. */
    setActiveLibraryTab(value: string): Promise<void>
    /** Returns the maximum concurrent download slots. */
    getMaxDownloads(): Promise<number>
    /** Sets the maximum concurrent download slots. */
    setMaxDownloads(value: number): Promise<void>
    /** Returns the current log level. */
    getLogLevel(): Promise<string>
    /** Sets the log level. */
    setLogLevel(value: string): Promise<void>
    /** Returns the enabled log scopes. */
    getLogScopes(): Promise<string[]>
    /** Sets the enabled log scopes. */
    setLogScopes(value: string[]): Promise<void>
    /** Returns the timestamp of the last file system eviction run. */
    getFsEvictionLastRun(): Promise<number>
    /** Sets the timestamp of the last file system eviction run. */
    setFsEvictionLastRun(value: number): Promise<void>
    /** Returns the timestamp of the last orphan cleanup run. */
    getFsOrphanLastRun(): Promise<number>
    /** Sets the timestamp of the last orphan cleanup run. */
    setFsOrphanLastRun(value: number): Promise<void>
    /** Returns the persisted view settings (sort, layout, etc.). */
    getViewSettings(): Promise<Record<string, unknown>>
    /** Sets the view settings. */
    setViewSettings(value: Record<string, unknown>): Promise<void>
  }
  /** General-purpose key-value storage (non-sensitive). */
  storage: {
    /** Returns the value for a key, or null if not set. */
    getItem(key: string): Promise<string | null>
    /** Stores a value for a key. */
    setItem(key: string, value: string): Promise<void>
    /** Removes a key and its value. */
    removeItem(key: string): Promise<void>
  }
  /** Secure key-value storage for sensitive data (e.g., keys, tokens). */
  secrets: {
    /** Returns the secret value for a key, or null if not set. */
    getItem(key: string): Promise<string | null>
    /** Stores a secret value for a key. */
    setItem(key: string, value: string): Promise<void>
    /** Deletes a secret by key. */
    deleteItem(key: string): Promise<void>
  }
  /** Authentication: mnemonic validation, app key management, and connection flow. */
  auth: {
    /** Returns the stored mnemonic hash, or null if not set. */
    getMnemonicHash(): Promise<string | null>
    /** Hashes and stores the mnemonic. */
    setMnemonicHash(mnemonic: string): Promise<void>
    /** Validates a mnemonic against the stored hash. */
    validateMnemonic(mnemonic: string): Promise<'valid' | 'invalid' | 'none'>
    /** Removes the stored mnemonic hash. */
    clearMnemonicHash(): Promise<void>
    /** Returns the app key for an indexer, or null if not registered. */
    getAppKey(indexerUrl: string): Promise<Uint8Array | null>
    /** Stores the app key for an indexer. */
    setAppKey(indexerUrl: string, key: Uint8Array): Promise<void>
    /** Returns whether an app key exists for the given indexer. */
    hasAppKey(indexerUrl: string): Promise<boolean>
    /** Returns all indexer URLs that have a registered app key. */
    getRegisteredIndexerURLs(): Promise<string[]>
    /** Removes all stored app keys. */
    clearAppKeys(): Promise<void>
    /** Step-by-step connection builder for pairing with an indexer. */
    builder: {
      /** Initializes a new connection flow for the given indexer URL with app metadata. */
      create(indexerUrl: string, appMeta: string): Promise<void>
      /** Sends a connection request; returns the response URL. */
      requestConnection(): Promise<string>
      /** Submits the approval response received from the indexer. */
      setConnectionResponse(appKey: string, response: string): Promise<void>
      /** Blocks until the connection is approved or rejected. */
      waitForApproval(): Promise<void>
      /** Attempts to connect using a hex-encoded app key directly. */
      connectWithKey(keyHex: string): Promise<boolean>
      /** Registers a new account with the given mnemonic; returns the app key hex. */
      register(mnemonic: string): Promise<string>
      /** Cancels the in-progress connection flow. */
      cancel(): void
    }
    /** Generates a new BIP-39 recovery phrase. */
    generateRecoveryPhrase(): Promise<string>
    /** Validates a recovery phrase, throwing if invalid. */
    validateRecoveryPhrase(phrase: string): Promise<void>
    /** Finalizes a successful connection by persisting the app key. */
    onConnected(appKeyHex: string, indexerUrl: string): Promise<void>
  }
  /** Sync state: tracks the current sync cursor and status. */
  sync: {
    /** Returns the current sync state snapshot. */
    getState(): SyncState
    /** Merges a partial update into the sync state. */
    setState(patch: Partial<SyncState>): void
    /** Reads the persisted sync-down cursor. */
    getSyncDownCursor(): Promise<ObjectsCursor | undefined>
    /** Persists the sync-down cursor (pass undefined to clear). */
    setSyncDownCursor(cursor: ObjectsCursor | undefined): Promise<void>
    /** Reads the persisted sync-up cursor. */
    getSyncUpCursor(): Promise<SyncUpCursor | undefined>
    /** Persists the sync-up cursor (pass undefined to clear). */
    setSyncUpCursor(cursor: SyncUpCursor | undefined): Promise<void>
  }
  /** Upload entry tracking: register, update, and clear in-progress uploads. */
  uploads: {
    /** Returns the full uploads state snapshot. */
    getState(): UploadsState
    /** Returns a single upload entry by ID. */
    getEntry(id: string): UploadEntry | undefined
    /** Registers a new upload entry. */
    register(entry: UploadEntry): void
    /** Partially updates an upload entry. */
    update(id: string, patch: Partial<UploadEntry>): void
    /** Removes a single upload entry. */
    remove(id: string): void
    /** Removes multiple upload entries. */
    removeMany(ids: string[]): void
    /** Removes all upload entries. */
    clear(): void
    /** Registers multiple upload entries as queued. */
    registerMany(entries: Array<{ id: string; size: number }>): void
    /** Sets upload status, clearing any previous error. No-op if entry does not exist. */
    setStatus(id: string, status: UploadStatus): void
    /** Marks an upload as failed with an error message. */
    setError(id: string, message: string): void
    /** Marks multiple uploads as uploading with batch info. */
    setBatchUploading(ids: string[], batchId: string): void
    /** Returns IDs of uploads that are actively being processed. */
    getActiveIds(): string[]
  }
  /** Download management: queue, track, cancel, and read downloaded files. */
  downloads: {
    /** Returns the full downloads state snapshot. */
    getState(): DownloadsState
    /** Returns a single download entry by ID. */
    getEntry(id: string): DownloadEntry | undefined
    /** Registers a queued download entry. */
    register(id: string): void
    /** Updates a download entry with a partial patch. */
    update(id: string, patch: Partial<DownloadEntry>): void
    /** Removes a completed or failed download entry. */
    remove(id: string): void
    /** Acquires a concurrency slot; resolves with an opaque token to pass to releaseSlot. */
    acquireSlot(): Promise<string>
    /** Releases a previously acquired concurrency slot. */
    releaseSlot(token: string): void
    /** Downloads a file to local storage. */
    downloadFile(fileId: string): Promise<void>
    /** Cancels a single in-progress download. */
    cancel(id: string): void
    /** Cancels all in-progress downloads. */
    cancelAll(): void
    /** Sets the maximum concurrent download slots and persists the value. */
    setMaxSlots(n: number): Promise<void>
  }
  /** Connection state: tracks whether the app is connected to an indexer. */
  connection: {
    /** Returns the current connection state snapshot. */
    getState(): ConnectionState
    /** Merges a partial update into the connection state. */
    setState(patch: Partial<ConnectionState>): void
  }
  /** Initialization state: tracks app startup steps and progress. */
  init: {
    /** Returns the current initialization state snapshot. */
    getState(): InitState
    /** Merges a partial update into the init state. */
    setState(patch: Partial<InitState>): void
    /** Adds or updates an initialization step. */
    setStep(step: InitStep): void
    /** Removes an initialization step by ID. */
    removeStep(id: string): void
  }
  /** Upload queue: enqueue files for background uploading. */
  uploader: {
    /** Enqueues files by ID for upload; returns counts of queued and skipped files. */
    enqueueByIds(
      fileIds: string[],
    ): Promise<{ queued: number; skipped: number }>
    /** Enqueues files with explicit URIs for upload. */
    enqueueWithUri(
      entries: Array<{
        fileId: string
        fileUri: string
        size: number
      }>,
    ): Promise<void>
    /** Shuts down the upload manager, waiting for in-flight uploads to finish. */
    shutdown(): Promise<void>
    /** Returns whether the upload manager is actively processing. */
    isRunning(): boolean
  }
  /** Returns the list of known hosts from the indexer. */
  hosts(): Promise<Host[]>
  /** Returns the current account info from the indexer. */
  account(): Promise<Account>
  /** SWR caches for all domains, used by UI hooks for cache invalidation. */
  caches: AppCaches
}

/** Non-serializable APIs that cannot cross an IPC/RPC boundary. Only used by bootstrap code. */
export interface AppServiceInternal {
  /** Injects the live SDK instance after auth completes. */
  setSdk(sdk: SdkAdapter | null): void
  /** Returns the current SDK instance, or null if not connected. */
  getSdk(): SdkAdapter | null
  /** Returns the SDK instance, throwing if not connected. */
  requireSdk(): SdkAdapter
  /** Wires the UploadManager with a live SDK reference. */
  initUploader(): void
  /** Runs a function inside a database transaction. */
  withTransaction(fn: () => Promise<void>): Promise<void>
}
