// Three import paths for getting files into the database:
//
// importFiles — User-initiated (picker, camera, share intent). Creates
//   placeholder records instantly so the UI updates, then copies files
//   in the background. The import scanner finalizes each file once the
//   local copy lands on disk. No dedup — manual imports always create
//   new records.
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
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
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
): Promise<FileContentResult | null> {
  let type = file.type
  if (type === 'application/octet-stream') {
    type = await getMimeType({ name: file.name, uri: sourceUri })
  }

  const fileUri = await copyFileToFs(file, sourceUri)
  if (!fileUri) return null

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
    const dir = await app().directories.getOrCreate(photoImportDir)
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
      const localUri = await getMediaLibraryUri(f.localId)
      if (!localUri) {
        f.localId = null
      }

      const bestUri = localUri ?? f.sourceUri
      if (!bestUri) {
        f.status = 'incomplete'
        f.statusDetails = 'noUri'
        return
      }

      const result = await processFileContent(f, bestUri)
      if (!result) {
        f.status = 'incomplete'
        f.statusDetails = 'processingFailed'
        return
      }

      f.type = result.type as MimeType
      f.hash = result.hash
      f.size = result.size
    },
  )

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

  await app().files.createMany(candidates, { conflictClause: 'OR IGNORE' })
  await app().optimize()

  if (addToImportDirectory) {
    const newFiles = candidates.filter((f) => !f.localId || !existingLocalIds.has(f.localId))
    await moveMediaToImportDirectory(newFiles)
  }

  triggerImportScanner()

  return { newCount, existingCount }
}

/**
 * Import for manual flows (document picker, camera, share intent, etc.).
 *
 * Creates placeholder FileRecords with hash: '' immediately so the UI
 * updates, then fires a background copy for each file. The import scanner
 * finalizes each file by hashing once the local copy lands on disk.
 *
 * Files with a localId (photos) can be recovered by the scanner via
 * resolveLocalId even if the background copy is interrupted.
 */
export async function importFiles(
  assets: Asset[] | undefined,
  defaultFileName: string = 'file',
): Promise<FileRecord[]> {
  const now = Date.now()

  type PendingCopy = { id: string; type: string; sourceUri: string }
  const pendingCopies: PendingCopy[] = []

  const placeholders: FileRecord[] = await Promise.all(
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
        pendingCopies.push({ id, type, sourceUri: a.sourceUri! })
        return {
          id,
          localId: a.id ?? null,
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
        }
      }),
  )

  if (placeholders.length > 0) {
    await app().files.createMany(placeholders)
    await app().optimize()
  }

  // Fire-and-forget: sourceURIs are ephemeral (document picker content://
  // URIs, share intent file:// paths) and must be copied promptly. The
  // copy runs without blocking the caller so the UI shows placeholders
  // immediately. If interrupted, files with localId are recovered by the
  // scanner via media library.
  void copyImportedFiles(pendingCopies)

  triggerImportScanner()
  return placeholders
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
