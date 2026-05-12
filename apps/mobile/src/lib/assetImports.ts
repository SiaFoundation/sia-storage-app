// Three ways assets enter the file DB:
//
// importAssets — picker / camera / share intent. Inserts placeholder
//   rows (hash:'') immediately so the UI updates, then copies bytes in
//   the background. The import scanner hashes and finalizes each row
//   once the local copy lands. localId is intentionally null here —
//   that namespace belongs to the auto-sync path, and reserving it
//   would block re-imports of previously deleted photos. Name
//   collisions in the destination directory bump a new version via
//   recalculateCurrentForGroup.
//
// syncAssets — recent-photo poll (syncNewPhotos). Copies and hashes
//   inline so duplicates are detected eagerly: by localId for same-
//   device repeats, by content hash for assets synced from another
//   device.
//
// catalogAssets — archive walk (syncPhotosArchive). Bulk INSERT OR
//   IGNORE placeholders only. No copy, no hash. The import scanner
//   finalizes these later with backpressure on the upload backlog.
//
// Signal is checked at loop/step boundaries only — leaf native calls
// (copyFileToFs, calculateContentHash, getMediaLibraryUri) aren't
// cancellable mid-flight, and iOS freezes them with the process anyway.

import { uniqueId } from '@siastorage/core/lib/uniqueId'
import { yieldToEventLoop } from '@siastorage/core/lib/yieldToEventLoop'
import type { FileRecord } from '@siastorage/core/types'
import { logger } from '@siastorage/logger'
import RNFS from 'react-native-fs'
import {
  markImportCopyComplete,
  markImportCopyStarted,
  triggerImportScanner,
} from '../managers/importScanner'
import { generateThumbnails } from '../managers/thumbnailer'
import { app } from '../stores/appService'
import { copyFileToFs } from '../stores/fs'
import { calculateContentHash } from './contentHash'
import { getMimeType, type MimeType } from './fileTypes'
import { getMediaLibraryUri } from './mediaLibrary'

const BATCH_SIZE = 10

async function processInBatches<T>(
  items: T[],
  batchSize: number,
  processor: (item: T) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    if (signal?.aborted) return
    const batch = items.slice(i, i + batchSize)
    await Promise.all(batch.map(processor))
    await yieldToEventLoop()
  }
}

export type Asset = {
  id: string | undefined
  sourceUri: string | undefined
  type: string | undefined
  name: string | undefined
  size?: number | undefined
  timestamp: string | undefined
}

type FileContentResult = {
  type: string
  hash: string
  size: number
}

/**
 * Shared file processing pipeline: MIME re-detection, copy to app cache,
 * SHA-256 content hash, and file size.
 */
async function processFileContent(
  file: { id: string; name: string; type: string },
  sourceUri: string,
  signal?: AbortSignal,
): Promise<FileContentResult | null> {
  if (signal?.aborted) return null
  let type = file.type
  if (type === 'application/octet-stream') {
    type = await getMimeType({ name: file.name, uri: sourceUri })
  }

  if (signal?.aborted) return null
  const fileUri = await copyFileToFs(file, sourceUri)
  if (!fileUri) return null

  if (signal?.aborted) return null
  const hash = await calculateContentHash(fileUri)
  if (!hash) return null

  const size = await getFileSize(fileUri)
  if (!size) return null

  return { type, hash, size }
}

type ParsedAssetMetadata = {
  name: string
  createdAt: number
  updatedAt: number
  type: MimeType
}

async function parseAssetMetadata(
  asset: Asset,
  defaultFileName: string,
): Promise<ParsedAssetMetadata> {
  const ts = new Date(asset.timestamp ?? Date.now()).getTime()
  return {
    name: asset.name ?? defaultFileName,
    createdAt: ts,
    updatedAt: ts,
    type: await getMimeType({
      type: asset.type,
      name: asset.name,
      uri: asset.sourceUri,
    }),
  }
}

// Resolved before createMany so the insert files rows into the directory atomically.
async function resolveImportDirectoryId(): Promise<string | null> {
  const photoImportDir = await app().settings.getPhotoImportDirectory()
  if (!photoImportDir) return null
  const dir = await app().directories.getOrCreateAtPath(photoImportDir)
  return dir.id
}

type CandidateFileRecord = {
  id: string
  localId: string | null
  name: string
  createdAt: number
  updatedAt: number
  type: MimeType
  hash: string | null
  size: number | null
  sourceUri: string | null
  status: 'existing' | 'new' | 'incomplete'
  statusDetails: 'foundByLocalId' | 'foundByContentHash' | 'noUri' | 'processingFailed' | null
}

type SyncAssetsOptions = {
  /** Place new files in the configured photo import directory. Used by auto-sync. */
  addToImportDirectory?: boolean
  /** Skip updating DB records for files that already exist. Prevents
   * spurious updatedAt bumps when the same assets are re-encountered
   * on every polling tick. Used by syncNewPhotos. */
  skipExistingUpdates?: boolean
}

/**
 * Background recent photo sync (syncNewPhotos). Copies files and computes
 * content hashes inline so duplicates are detected immediately — by
 * localId (same device) or content hash (synced from another device).
 * This eager processing prevents re-importing files the system already
 * knows about.
 */
export async function syncAssets(
  assets: Asset[] | undefined,
  defaultFileName: string = 'file',
  { addToImportDirectory = false, skipExistingUpdates = false }: SyncAssetsOptions = {},
  signal?: AbortSignal,
) {
  const importDirectoryId = addToImportDirectory ? await resolveImportDirectoryId() : null
  const importedAt = Date.now()

  const candidateFiles: CandidateFileRecord[] = await Promise.all(
    (assets ?? []).map(async (a) => {
      const meta = await parseAssetMetadata(a, defaultFileName)
      return {
        id: uniqueId(),
        localId: a.id ?? null,
        sourceUri: a.sourceUri ?? null,
        ...meta,
        hash: null,
        size: null,
        status: 'new' as const,
        statusDetails: null,
      }
    }),
  )

  const existingLocalIds = await app().files.getByLocalIds(
    candidateFiles.filter((a) => !!a.localId).map((a) => a.localId!),
  )
  for (const f of existingLocalIds) {
    const validFile = candidateFiles.find((v) => v.localId === f.localId)
    if (validFile) {
      validFile.id = f.id
      validFile.status = 'existing'
      validFile.statusDetails = 'foundByLocalId'
    }
  }

  await processInBatches(
    candidateFiles.filter((f) => f.status === 'new'),
    BATCH_SIZE,
    async (f) => {
      const resolved = await getMediaLibraryUri(f.localId)
      if (resolved.status === 'deleted') {
        f.localId = null
      }

      const bestUri = (resolved.status === 'resolved' ? resolved.uri : null) ?? f.sourceUri
      if (!bestUri) {
        f.status = 'incomplete'
        f.statusDetails = 'noUri'
        return
      }

      const result = await processFileContent(f, bestUri, signal)
      if (!result) {
        f.status = 'incomplete'
        f.statusDetails = 'processingFailed'
        return
      }

      f.type = result.type as MimeType
      f.hash = result.hash
      f.size = result.size
    },
    signal,
  )

  if (signal?.aborted) {
    return { files: [], updatedFiles: [], warnings: [] }
  }

  const existingContentHashes = await app().files.getByContentHashes(
    candidateFiles.filter((f) => f.status === 'new' && f.hash !== null).map((f) => f.hash!),
  )
  const contentHashDuplicateCount = existingContentHashes.length

  for (const f of existingContentHashes) {
    const validFile = candidateFiles.find((v) => v.hash === f.hash)
    if (validFile) {
      validFile.id = f.id
      validFile.status = 'existing'
      validFile.statusDetails = 'foundByContentHash'
    }
  }

  const newFiles = candidateFiles
    .filter((f) => f.status === 'new' && f.hash !== null && f.size !== null)
    .map((f) => ({
      id: f.id,
      localId: f.localId,
      name: f.name,
      createdAt: f.createdAt,
      // Bump updatedAt so (name, dir) collisions resolve to the freshly synced row.
      updatedAt: addToImportDirectory ? importedAt : f.updatedAt,
      addedAt: importedAt,
      type: f.type,
      kind: 'file' as const,
      size: f.size!,
      hash: f.hash!,
      trashedAt: null,
      deletedAt: null,
      objects: {},
    }))

  const incompleteFiles = candidateFiles.filter((f) => f.status === 'incomplete')
  const existingFiles = candidateFiles.filter((f) => f.status === 'existing')

  const warnings: string[] = []
  logger.debug('syncAssets', 'result', {
    picked: candidateFiles.length,
    new: newFiles.length,
    incomplete: incompleteFiles.length,
    existing: existingFiles.length,
    contentHashDuplicates: contentHashDuplicateCount,
  })
  if (contentHashDuplicateCount > 0) {
    warnings.push(
      `${contentHashDuplicateCount} ${contentHashDuplicateCount === 1 ? 'file already exists' : 'files already exist'} and ${contentHashDuplicateCount === 1 ? 'was' : 'were'} imported again.`,
    )
  }

  if (!skipExistingUpdates) {
    await app().files.updateMany(
      existingFiles.map((f) => ({
        id: f.id,
        name: f.name,
        type: f.type,
        localId: f.localId,
      })),
    )
  }
  await app().files.createMany(newFiles, { directoryId: importDirectoryId })
  await app().optimize()

  if (signal?.aborted) {
    return { files: newFiles, updatedFiles: existingFiles, warnings }
  }

  logger.debug('syncAssets', 'generating_thumbnails', {
    count: newFiles.length,
  })
  generateThumbnails(newFiles)

  return {
    files: newFiles,
    updatedFiles: existingFiles,
    warnings,
  }
}

type CatalogAssetsOptions = {
  /** Place new files in the configured photo import directory. Used by archive sync. */
  addToImportDirectory?: boolean
}

/**
 * Archive library walk (syncPhotosArchive). Creates placeholder records
 * with hash: '' and size: 0, using INSERT OR IGNORE to silently skip
 * localId duplicates. Queries existing localIds first so callers get
 * an accurate new-vs-existing breakdown. No copy, no hash — the
 * import scanner handles those with backpressure based on the upload backlog.
 */
export async function catalogAssets(
  assets: Asset[] | undefined,
  defaultFileName: string = 'file',
  { addToImportDirectory = false }: CatalogAssetsOptions = {},
  signal?: AbortSignal,
) {
  const importDirectoryId = addToImportDirectory ? await resolveImportDirectoryId() : null
  const importedAt = Date.now()

  const candidates: FileRecord[] = await Promise.all(
    (assets ?? []).map(async (a) => {
      const meta = await parseAssetMetadata(a, defaultFileName)
      return {
        id: uniqueId(),
        localId: a.id ?? null,
        ...meta,
        // Bump updatedAt so (name, dir) collisions resolve to the freshly synced row.
        updatedAt: addToImportDirectory ? importedAt : meta.updatedAt,
        addedAt: importedAt,
        kind: 'file' as const,
        size: 0,
        hash: '',
        trashedAt: null,
        deletedAt: null,
        objects: {},
      }
    }),
  )

  if (signal?.aborted) return { newCount: 0, existingCount: 0 }

  // Catch-up dedup for rows that arrived via sync-down (no localId) or
  // had their localId nulled by a re-sync (reinstall, restore, sign out
  // and back in). When the archive walk later sees the same photo on
  // the camera roll, the existing row has no localId to match against,
  // so localId-based dedup misses.
  // (name, createdAt) is the cheapest stable identity available without
  // reading bytes; the query is directory-scoped via getCurrentByNames-
  // InDirectory, so the same photo in a different folder is unaffected.
  //
  // Same-name files in the same folder collapse to one visible row
  // elsewhere in the app, so distinct files that share a filename end
  // up as a single entry regardless of what this dedup decides. See
  // "Known limits" below for the future-work shape.
  //
  // Asymmetric: only fires against rows where existing.localId IS NULL,
  // so same-device siblings sharing (name, captureTime) — e.g., OEM
  // camera bursts that reuse filenames at second precision — aren't
  // blocked by this rule. (They still collapse downstream via the
  // existing (name, dir) version-grouping; not changed here.)
  //
  // Known limits — two separate problems that both need future work:
  //  (1) Identity — recognizing the same file across devices or after
  //      a re-sync. (name, createdAt) is what we can compute upfront
  //      without reading bytes. It misses for iOS assets whose
  //      filenames are storage UUIDs that differ per device (common
  //      for iCloud-restored or shared assets).
  //  (2) Name collisions on insert — once a file is decided to be
  //      new, it's stored under the filename the OS reported. If two
  //      distinct files happen to share that filename in the same
  //      folder (counter wraparound, AirDrop name clashes, OEM burst
  //      siblings), they collapse to one visible row downstream even
  //      though identity correctly flagged them as different.
  //
  // (1) takes stronger upfront identity — native modules surfacing
  // stable cloud IDs or fingerprints. (2) takes uniquifying the name
  // at import time so distinct files don't merge in storage. SHA-256
  // hashes are computed at finalize but aren't used for dedup yet;
  // they'd address (1), not (2).
  const namesToCheck = Array.from(new Set(candidates.map((c) => c.name)))
  const existingByName =
    namesToCheck.length > 0
      ? await app().files.getCurrentByNamesInDirectory(namesToCheck, importDirectoryId)
      : []
  const syncedDownKeys = new Set<string>()
  for (const f of existingByName) {
    if (f.localId === null) {
      syncedDownKeys.add(`${f.name}\x00${f.createdAt}`)
    }
  }
  const dedupedCandidates = candidates.filter(
    (c) => !syncedDownKeys.has(`${c.name}\x00${c.createdAt}`),
  )
  const syncedDownDuplicateCount = candidates.length - dedupedCandidates.length

  const localIds = dedupedCandidates.filter((f) => f.localId).map((f) => f.localId!)
  const existingFiles = localIds.length > 0 ? await app().files.getByLocalIds(localIds) : []
  const localIdDuplicateCount = new Set(existingFiles.map((f) => f.localId)).size
  const existingCount = localIdDuplicateCount + syncedDownDuplicateCount
  const newCount = candidates.length - existingCount

  logger.debug('catalogAssets', 'result', {
    count: candidates.length,
    newCount,
    existingCount,
    syncedDownDuplicateCount,
  })
  if (syncedDownDuplicateCount > 0) {
    logger.info('catalogAssets', 'dedup_by_name_and_time', {
      count: syncedDownDuplicateCount,
    })
  }

  if (signal?.aborted) return { newCount: 0, existingCount: 0 }

  await app().files.createMany(dedupedCandidates, {
    conflictClause: 'OR IGNORE',
    directoryId: importDirectoryId,
  })
  await app().optimize()

  triggerImportScanner()

  return { newCount, existingCount }
}

export type ImportFilesOptions = {
  /** Folder the picker was opened from. New files land here directly. Defaults to root (null). */
  destinationDirectoryId?: string | null
  /** Tag to attach to every newly imported file. Used when the picker was opened from a tag's view. */
  assignTagName?: string
  /** Called once per file as the background copy completes, with the
   * source size in bytes. Drives the import-progress modal. */
  onCopyProgress?: (bytes: number) => void
}

export type ImportAssetsResult = {
  /** Files that landed in the library, in candidate order. */
  files: FileRecord[]
  /** How many picks share a name with an existing current file in the
   * destination directory and therefore became a new version of it. */
  newVersionCount: number
  /** Sum of source sizes across the picked assets. */
  totalBytes: number
  /** Resolves once every file's bytes are persisted in app FS. */
  copyPromise: Promise<{ copied: number; failed: number }>
}

/**
 * Insert placeholder rows immediately, then copy bytes in the background.
 * The import scanner finalizes each row (hash + size) once the copy lands.
 *
 * localId stays null — that namespace belongs to auto-sync, and using it
 * here would block re-imports of previously deleted photos. Versioning
 * is handled by recalculateCurrentForGroup at insert time; the
 * newVersionCount in the result lets the caller surface a toast.
 */
export async function importAssets(
  assets: Asset[] | undefined,
  defaultFileName: string = 'file',
  options: ImportFilesOptions = {},
): Promise<ImportAssetsResult> {
  const { destinationDirectoryId = null, assignTagName, onCopyProgress } = options
  const now = Date.now()

  type Candidate = { placeholder: FileRecord; sourceUri: string }

  const candidates: Candidate[] = await Promise.all(
    (assets ?? [])
      .filter((a) => !!a.sourceUri)
      .map(async (a) => {
        const id = uniqueId()
        const type = await getMimeType({
          type: a.type,
          name: a.name,
          uri: a.sourceUri,
        })
        const name = a.name ?? defaultFileName
        const ts = new Date(a.timestamp ?? now).getTime()
        return {
          placeholder: {
            id,
            localId: null,
            name,
            createdAt: ts,
            // Bump updatedAt so a re-import wins the current-version recalc against
            // an existing row with the same (name, directory).
            updatedAt: now,
            addedAt: now,
            type,
            kind: 'file' as const,
            size: a.size ?? 0,
            hash: '',
            trashedAt: null,
            deletedAt: null,
            objects: {},
          } satisfies FileRecord,
          sourceUri: a.sourceUri!,
        }
      }),
  )

  if (candidates.length === 0) {
    return {
      files: [],
      newVersionCount: 0,
      totalBytes: 0,
      copyPromise: Promise.resolve({ copied: 0, failed: 0 }),
    }
  }

  // parseAssetMetadata can be slow (large picker batches, share-extension
  // files); an iOS background landing mid-flight would fast-reject the
  // first DB read. Gate so the import resumes after the gate reopens.
  // The per-file copy below is safe by construction (app.fs.copyFile
  // gates internally).
  await app().db.waitUntilActive()

  const uniqueNames = Array.from(new Set(candidates.map((c) => c.placeholder.name)))
  const existingCurrent = await app().files.getCurrentByNamesInDirectory(
    uniqueNames,
    destinationDirectoryId,
  )
  const existingNames = new Set(existingCurrent.map((f) => f.name))
  const newVersionCount = candidates.reduce(
    (n, c) => (existingNames.has(c.placeholder.name) ? n + 1 : n),
    0,
  )

  await app().files.createMany(
    candidates.map((c) => c.placeholder),
    {
      directoryId: destinationDirectoryId,
    },
  )

  const insertedIds = candidates.map((c) => c.placeholder.id)
  // Register synchronously, before the next await. The scanner runs on
  // its own 3s tick and would otherwise see these placeholders with no
  // fs row and no localId during the tag/optimize/getByIds awaits below
  // and mark them lost. copyAssets clears each ID in its per-file finally.
  for (const id of insertedIds) markImportCopyStarted(id)

  let copyDispatched = false
  try {
    if (assignTagName && insertedIds.length > 0) {
      await app().tags.addToFiles(insertedIds, assignTagName)
    }

    await app().optimize()

    // Preserve candidate order in the returned array.
    let files: FileRecord[] = []
    if (insertedIds.length > 0) {
      const fetched = await app().files.getByIds(insertedIds)
      const byId = new Map(fetched.map((f) => [f.id, f]))
      files = insertedIds.map((id) => byId.get(id)).filter((f): f is FileRecord => !!f)
    }

    // Each copy dispatches to a native RNFS thread that holds the source
    // URI open once it starts reading, so ephemeral picker/share URIs are
    // captured before the caller can do anything else. The native thread
    // freezes with the process on iOS suspension and thaws on resume. If
    // iOS terminates rather than suspends, the import is lost — the
    // import-progress modal warns the user not to close the app.
    const copyPromise = copyAssets(
      candidates.map((c) => ({
        id: c.placeholder.id,
        type: c.placeholder.type,
        size: c.placeholder.size,
        sourceUri: c.sourceUri,
      })),
      onCopyProgress,
    )
    copyDispatched = true

    triggerImportScanner()
    const totalBytes = candidates.reduce((s, c) => s + c.placeholder.size, 0)
    return { files, newVersionCount, totalBytes, copyPromise }
  } finally {
    if (!copyDispatched) {
      for (const id of insertedIds) markImportCopyComplete(id)
    }
  }
}

async function copyAssets(
  copies: { id: string; type: string; size: number; sourceUri: string }[],
  onProgress?: (bytes: number) => void,
): Promise<{ copied: number; failed: number }> {
  // IDs are already registered by importAssets right after createMany;
  // we only clear them here as each copy resolves.
  let copied = 0
  let failed = 0
  for (const { id, type, size, sourceUri } of copies) {
    try {
      await copyFileToFs({ id, type }, sourceUri)
      copied += 1
      onProgress?.(size)
    } catch (e) {
      failed += 1
      logger.warn('importAssets', 'copy_failed', {
        fileId: id,
        error: e as Error,
      })
    } finally {
      markImportCopyComplete(id)
    }
  }
  triggerImportScanner()
  return { copied, failed }
}

async function getFileSize(fileUri: string) {
  try {
    const stat = await RNFS.stat(fileUri)
    return stat.size ?? null
  } catch {
    return null
  }
}
