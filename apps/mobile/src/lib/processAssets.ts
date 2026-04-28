// Three import paths for getting files into the database:
//
// importFiles — User-initiated (picker, camera, share intent). Creates
//   placeholder records instantly so the UI updates, then copies files
//   in the background. The import scanner finalizes each file once the
//   local copy lands on disk. localId is intentionally NOT set on
//   manual imports — that field is the auto-sync path's primitive for
//   recognizing OS assets across ticks; using it for manual import
//   would reserve the localId slot and break re-imports of previously
//   deleted photos. Manual import takes the (name, directoryId) the
//   user opened the picker from and lets the version system bump
//   collisions via recalculateCurrentForGroup.
//
// syncAssets — Background recent photo sync (syncNewPhotos). Copies
//   files and computes content hashes inline so duplicates (by localId
//   or content hash) are detected immediately, preventing re-importing
//   files already tracked locally or synced from another device.
//
// catalogAssets — Archive library walk (syncPhotosArchive). Creates
//   placeholder records in bulk via INSERT OR IGNORE (no copy, no hash).
//   The import scanner finalizes these in the background with
//   backpressure based on the upload backlog.
//
// Suspension signal policy:
//   processInBatches and processFileContent accept a signal and check at
//   loop boundaries / step boundaries. The signal is NOT plumbed into
//   the per-file leaves (copyFileToFs, calculateContentHash,
//   getMediaLibraryUri) because those wrap single native calls that
//   can't be cancelled mid-flight in JS. Leaf-level checks would only
//   duplicate the loop-level skip one statement earlier. copyImportedFiles
//   is fire-and-forget: the user-initiated import path doesn't block
//   shutdown, and native copies ride the iOS freeze/thaw naturally.

import { uniqueId } from '@siastorage/core/lib/uniqueId'
import { yieldToEventLoop } from '@siastorage/core/lib/yieldToEventLoop'
import type { FileRecord } from '@siastorage/core/types'
import { logger } from '@siastorage/logger'
import RNFS from 'react-native-fs'
import { triggerImportScanner } from '../managers/importScanner'
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

async function moveMediaToImportDirectory(files: FileRecord[]): Promise<void> {
  const photoImportDir = await app().settings.getPhotoImportDirectory()
  if (!photoImportDir) return
  const mediaFileIds = files
    .filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'))
    .map((f) => f.id)
  if (mediaFileIds.length > 0) {
    const dir = await app().directories.getOrCreateAtPath(photoImportDir)
    await app().directories.moveFiles(mediaFileIds, dir.id)
  }
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
  /** Move newly imported media files into the configured photo import
   * directory. Used by auto-sync. */
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
      updatedAt: f.updatedAt,
      addedAt: Date.now(),
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
  await app().files.createMany(newFiles)
  await app().optimize()

  if (addToImportDirectory) {
    await moveMediaToImportDirectory(newFiles)
  }

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
  /** Move newly imported media files into the configured photo import
   * directory. Used by archive sync. */
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
  const candidates: FileRecord[] = await Promise.all(
    (assets ?? []).map(async (a) => {
      const meta = await parseAssetMetadata(a, defaultFileName)
      return {
        id: uniqueId(),
        localId: a.id ?? null,
        ...meta,
        addedAt: Date.now(),
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

  const localIds = candidates.filter((f) => f.localId).map((f) => f.localId!)
  const existingFiles = localIds.length > 0 ? await app().files.getByLocalIds(localIds) : []
  const existingLocalIds = new Set(existingFiles.map((f) => f.localId))
  const existingCount = existingLocalIds.size
  const newCount = candidates.length - existingCount

  logger.debug('catalogAssets', 'result', {
    count: candidates.length,
    newCount,
    existingCount,
  })

  if (signal?.aborted) return { newCount: 0, existingCount: 0 }

  await app().files.createMany(candidates, { conflictClause: 'OR IGNORE' })
  await app().optimize()

  if (addToImportDirectory) {
    const newFiles = candidates.filter((f) => !f.localId || !existingLocalIds.has(f.localId))
    await moveMediaToImportDirectory(newFiles)
  }

  triggerImportScanner()

  return { newCount, existingCount }
}

export type ImportFilesOptions = {
  /** Folder the picker was opened from. New files land here directly. Defaults to root (null). */
  destinationDirectoryId?: string | null
  /** Tag to attach to every newly imported file. Used when the picker was opened from a tag's view. */
  assignTagName?: string
}

export type ImportFilesResult = {
  /** Files that landed in the library, in candidate order. */
  files: FileRecord[]
  /**
   * How many of the picked files share a name with an existing current
   * file in the destination directory and therefore became a new version
   * of it. Used by the caller to surface a one-line toast.
   */
  newVersionCount: number
}

/**
 * Import for manual flows (document picker, camera, share intent, etc.).
 *
 * Creates placeholder FileRecords with hash: '' immediately so the UI
 * updates, then fires a background copy for each file. The import scanner
 * finalizes each file by hashing once the local copy lands on disk.
 *
 * Manual imports always succeed: they don't reserve the localId slot
 * (auto-sync owns that namespace) and don't dedup by content hash.
 * Versioning happens automatically — if a pick shares (name, directoryId)
 * with an existing current file, recalculateCurrentForGroup bumps it as
 * a new version. The pre-check just counts how many will do that, so
 * the caller can tell the user.
 */
export async function importFiles(
  assets: Asset[] | undefined,
  defaultFileName: string = 'file',
  options: ImportFilesOptions = {},
): Promise<ImportFilesResult> {
  const { destinationDirectoryId = null, assignTagName } = options
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
            updatedAt: ts,
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
    return { files: [], newVersionCount: 0 }
  }

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

  await app().files.createMany(candidates.map((c) => c.placeholder))

  const insertedCandidates = candidates
  const insertedIds = candidates.map((c) => c.placeholder.id)

  if (destinationDirectoryId !== null && insertedIds.length > 0) {
    await app().directories.moveFiles(insertedIds, destinationDirectoryId)
  }

  if (assignTagName && insertedIds.length > 0) {
    await app().tags.addToFiles(insertedIds, assignTagName)
  }

  await app().optimize()

  // Fetch post-move records so the caller sees the right directoryId.
  // Preserve candidate order in the returned array.
  let files: FileRecord[] = []
  if (insertedIds.length > 0) {
    const fetched = await app().files.getByIds(insertedIds)
    const byId = new Map(fetched.map((f) => [f.id, f]))
    files = insertedIds.map((id) => byId.get(id)).filter((f): f is FileRecord => !!f)
  }

  // Fire-and-forget: each copy dispatches to a native RNFS thread that
  // holds the source URI open once it starts reading, so ephemeral
  // picker/share URIs are captured by the native call before the caller
  // can do anything else. The native thread freezes with the process on
  // iOS suspension and thaws on resume. If iOS terminates (rather than
  // suspends) the import is lost — same as before.
  void copyImportedFiles(
    insertedCandidates.map((c) => ({
      id: c.placeholder.id,
      type: c.placeholder.type,
      sourceUri: c.sourceUri,
    })),
  )

  triggerImportScanner()
  return { files, newVersionCount }
}

async function copyImportedFiles(
  copies: { id: string; type: string; sourceUri: string }[],
): Promise<void> {
  for (const { id, type, sourceUri } of copies) {
    try {
      await copyFileToFs({ id, type }, sourceUri)
    } catch (e) {
      logger.warn('importFiles', 'copy_failed', {
        fileId: id,
        error: e as Error,
      })
    }
  }
  triggerImportScanner()
}

async function getFileSize(fileUri: string) {
  try {
    const stat = await RNFS.stat(fileUri)
    return stat.size ?? null
  } catch {
    return null
  }
}
