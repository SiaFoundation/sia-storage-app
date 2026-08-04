import type { DatabaseAdapter } from '@siastorage/core/adapters'
import * as sql from '@siastorage/core/db/sql'
import { naturalSortKey } from '@siastorage/core/lib/naturalSortKey'

/*
 * Seeds the imports scenarios: one sealed library-scan import mid-drain
 * (terminal rows accumulated, a deep pending backlog, a few active claims, a
 * backoff slice at the newest addedAt end so the LIFO pending walk has to step
 * past it), a run of finished historical imports, and a files library as the
 * backdrop for the stats aggregates that share the connection.
 *
 * The two profiles bracket the range. `drain` is a device-sized library with
 * one large import mid-drain. `archive100k` is the floor a page cannot lower:
 * the active import is always on the first page, so its children are
 * aggregated on every refetch no matter how the list is paged.
 */

export const IMPORTS_INDEXER_URL = 'https://bench.indexer'
export const ARCHIVE_IMPORT_ID = 'imp-archive'
export const ARCHIVE_DIR_ID = 'idir-0001'

export type ImportsProfile = {
  name: string
  description: string
  libraryFiles: number
  /** Children of the mid-drain library-scan import. */
  archiveFiles: number
  /** Finished picker/camera imports behind it. */
  historicalImports: number
  /** Average children per historical import; the generator fans out around it. */
  historicalChildren: number
}

export const IMPORTS_PROFILES: Record<string, ImportsProfile> = {
  drain: {
    name: 'drain',
    description: '15k-file archive mid-drain, 30 finished imports, 30k library',
    libraryFiles: 30_000,
    archiveFiles: 15_000,
    historicalImports: 30,
    historicalChildren: 100,
  },
  archive100k: {
    name: 'archive100k',
    description: '100k-file archive mid-drain, 200 finished imports, 30k library',
    libraryFiles: 30_000,
    archiveFiles: 100_000,
    historicalImports: 200,
    historicalChildren: 40,
  },
}

// Fractions of the archive in each non-pending state, so a profile's mix holds
// as archiveFiles scales.
const ADDED_FRACTION = 7 / 15
const DUPLICATE_FRACTION = 1 / 30
const FAILED_FRACTION = 1 / 150
const UNAVAILABLE_FRACTION = 1 / 300
const BACKOFF_FRACTION = 1 / 75
const ARCHIVE_ACTIVE = 4

export type ImportsDatasetInfo = {
  libraryFiles: number
  objectsPopulated: number
  importCount: number
  importFileCount: number
  generationTimeMs: number
}

export async function seedLibraryFiles(db: DatabaseAdapter, count: number): Promise<number> {
  const now = Date.now()
  const baseTime = now - 365 * 24 * 60 * 60 * 1000
  for (let d = 0; d < 10; d++) {
    const id = `idir-${String(d).padStart(4, '0')}`
    const name = `import-folder-${d}`
    await db.runAsync(
      'INSERT INTO directories (id, path, createdAt, nameSortKey) VALUES (?, ?, ?, ?)',
      id,
      name,
      now,
      naturalSortKey(name),
    )
  }

  let objects = 0
  let fileBuffer: Record<string, unknown>[] = []
  let objectBuffer: Record<string, unknown>[] = []
  for (let i = 0; i < count; i++) {
    const id = `lf-${i}`
    const name = `photo-${i}.jpg`
    const createdAt = baseTime + i * 1000
    fileBuffer.push({
      id,
      name,
      nameSortKey: naturalSortKey(name),
      size: 2_000_000 + (i % 3_000_000),
      createdAt,
      updatedAt: createdAt,
      type: 'image/jpeg',
      kind: 'file',
      mediaAssetId: `lib-asset-${i}`,
      hash: `lib-hash-${i}`,
      addedAt: createdAt,
      thumbForId: null,
      thumbSize: null,
      directoryId: `idir-${String(i % 10).padStart(4, '0')}`,
      trashedAt: null,
      deletedAt: null,
      lostReason: null,
      current: 1,
    })
    if (i % 5 !== 0) {
      objectBuffer.push({
        fileId: id,
        indexerURL: IMPORTS_INDEXER_URL,
        id: `lobj-${i}`,
        slabs: '[]',
        encryptedDataKey: '',
        encryptedMetadataKey: '',
        encryptedMetadata: '',
        dataSignature: '',
        metadataSignature: '',
        createdAt,
        updatedAt: createdAt,
      })
      objects++
    }
    if (fileBuffer.length >= 10_000) {
      await sql.insertMany(db, 'files', fileBuffer)
      await sql.insertMany(db, 'objects', objectBuffer)
      fileBuffer = []
      objectBuffer = []
    }
  }
  if (fileBuffer.length > 0) await sql.insertMany(db, 'files', fileBuffer)
  if (objectBuffer.length > 0) await sql.insertMany(db, 'objects', objectBuffer)
  return objects
}

export async function generateImportsDataset(
  db: DatabaseAdapter,
  profile: ImportsProfile,
): Promise<{
  info: Omit<ImportsDatasetInfo, 'libraryFiles' | 'objectsPopulated'>
  allImportIds: string[]
}> {
  const start = performance.now()
  const now = Date.now()
  const archiveStart = now - 6 * 60 * 60 * 1000
  const archiveCount = profile.archiveFiles

  const ARCHIVE_ADDED = Math.floor(archiveCount * ADDED_FRACTION)
  const ARCHIVE_DUPLICATE = Math.floor(archiveCount * DUPLICATE_FRACTION)
  const ARCHIVE_FAILED = Math.floor(archiveCount * FAILED_FRACTION)
  const ARCHIVE_UNAVAILABLE = Math.floor(archiveCount * UNAVAILABLE_FRACTION)
  const ARCHIVE_BACKOFF = Math.floor(archiveCount * BACKOFF_FRACTION)

  const importRows: Record<string, unknown>[] = [
    {
      id: ARCHIVE_IMPORT_ID,
      source: 'library-scan',
      directoryId: ARCHIVE_DIR_ID,
      pendingTags: null,
      expectedCount: archiveCount,
      dedupByHash: 1,
      dirSourceRef: null,
      sealed: 1,
      startedAt: archiveStart,
      updatedAt: now,
      // Draining, so it is the most recently active import and sorts first.
      lastActivityAt: now,
    },
  ]

  const allImportIds = [ARCHIVE_IMPORT_ID]
  const histStart = archiveStart - profile.historicalImports * 24 * 60 * 60 * 1000
  const histChildren: number[] = []
  const childSpread = Math.max(1, profile.historicalChildren * 2 - 1)
  for (let k = 0; k < profile.historicalImports; k++) {
    const id = `imp-hist-${String(k).padStart(4, '0')}`
    allImportIds.push(id)
    const startedAt = histStart + k * 24 * 60 * 60 * 1000
    const children = 1 + ((k * 7) % childSpread)
    histChildren.push(children)
    importRows.push({
      id,
      source: k % 2 === 0 ? 'picker' : 'camera',
      directoryId: null,
      pendingTags: null,
      expectedCount: children,
      dedupByHash: 1,
      dirSourceRef: null,
      sealed: 1,
      startedAt,
      updatedAt: startedAt,
      lastActivityAt: startedAt,
    })
  }
  // Parents first: import_files.importId carries a foreign key.
  await sql.insertMany(db, 'imports', importRows)

  // State layout over addedAt order (oldest first): terminals first (the drain
  // consumes oldest-staged work last under LIFO, but terminal rows accumulate
  // regardless of which end they came from), then the active claims, then the
  // pending backlog with the backoff slice at the newest end.
  const terminalEnd = ARCHIVE_ADDED + ARCHIVE_DUPLICATE + ARCHIVE_FAILED + ARCHIVE_UNAVAILABLE
  const activeEnd = terminalEnd + ARCHIVE_ACTIVE
  let fileBuffer: Record<string, unknown>[] = []
  let importFileCount = 0

  async function flush() {
    if (fileBuffer.length > 0) {
      await sql.insertMany(db, 'import_files', fileBuffer)
      fileBuffer = []
    }
  }

  for (let i = 0; i < archiveCount; i++) {
    let state = 'pending'
    let reason: string | null = null
    let attempts = 0
    let nextAttemptAt = 0
    let claimedAt: number | null = null
    let claimToken: string | null = null
    const size = 2_000_000 + (i % 3_000_000)
    let copyBytes = 0
    let hash: string | null = null

    if (i < ARCHIVE_ADDED) {
      state = 'added'
      copyBytes = size
      hash = `imp-hash-${i}`
    } else if (i < ARCHIVE_ADDED + ARCHIVE_DUPLICATE) {
      state = 'duplicate'
      copyBytes = size
      hash = `imp-hash-${i % ARCHIVE_ADDED}`
    } else if (i < ARCHIVE_ADDED + ARCHIVE_DUPLICATE + ARCHIVE_FAILED) {
      state = 'failed'
      reason = 'copy-failed'
      attempts = 3
    } else if (i < terminalEnd) {
      state = 'unavailable'
      reason = 'source-missing'
      attempts = 1
    } else if (i < activeEnd) {
      state = 'active'
      claimedAt = now - 5_000
      claimToken = `tok-${i}`
      copyBytes = Math.floor(size / 2)
    } else if (i >= archiveCount - ARCHIVE_BACKOFF) {
      attempts = 1
      nextAttemptAt = now + 10 * 60 * 1000
    }

    const addedAt = archiveStart + i * 100
    fileBuffer.push({
      id: `if-${String(i).padStart(6, '0')}`,
      importId: ARCHIVE_IMPORT_ID,
      state,
      reason,
      name: `archive-photo-${i}.jpg`,
      type: 'image/jpeg',
      size,
      hash,
      createdAt: addedAt,
      updatedAt: addedAt,
      addedAt,
      directoryId: i % 2 === 0 ? ARCHIVE_DIR_ID : null,
      mediaAssetId: `asset-${i}`,
      sourceKind: 'media',
      sourceUri: null,
      sourceRef: null,
      copyBytes,
      attempts,
      nextAttemptAt,
      claimedAt,
      claimToken,
    })
    importFileCount++
    if (fileBuffer.length >= 5_000) await flush()
  }

  for (let k = 0; k < profile.historicalImports; k++) {
    const id = `imp-hist-${String(k).padStart(4, '0')}`
    const startedAt = histStart + k * 24 * 60 * 60 * 1000
    const children = histChildren[k]
    for (let c = 0; c < children; c++) {
      const size = 1_500_000 + (c % 2_000_000)
      const addedAt = startedAt + c * 200
      fileBuffer.push({
        id: `hf-${k}-${String(c).padStart(4, '0')}`,
        importId: id,
        state: 'added',
        reason: null,
        name: `hist-${k}-${c}.jpg`,
        type: 'image/jpeg',
        size,
        hash: `hist-hash-${k}-${c}`,
        createdAt: addedAt,
        updatedAt: addedAt,
        addedAt,
        directoryId: null,
        mediaAssetId: null,
        sourceKind: 'ephemeral',
        sourceUri: null,
        sourceRef: null,
        copyBytes: size,
        attempts: 0,
        nextAttemptAt: 0,
        claimedAt: null,
        claimToken: null,
      })
      importFileCount++
    }
    if (fileBuffer.length >= 5_000) await flush()
  }
  await flush()

  return {
    info: {
      importCount: importRows.length,
      importFileCount,
      generationTimeMs: Math.round(performance.now() - start),
    },
    allImportIds,
  }
}
