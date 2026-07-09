// Builds import rows: importAssets covers the one-shot sources (picker,
// camera, share) and stages their `pending` import_files rows for the scanner.
// buildPhotoCandidateRows only builds candidate rows for new-photos and
// library-scan; those callers stage the rows themselves.

import { uniqueId } from '@siastorage/core/lib/uniqueId'
import { logger } from '@siastorage/logger'
import { getAssetSizes, isNativeAvailable } from 'import-sources'
import type {
  ImportFileRow,
  ImportRow,
  ImportSource,
  ImportSourceKind,
} from '@siastorage/core/db/operations'
import { app } from '../stores/appService'
import { getMimeType, type MimeType } from './fileTypes'

export type Asset = {
  id: string | undefined
  sourceUri: string | undefined
  type: string | undefined
  name: string | undefined
  size?: number | undefined
  timestamp: string | undefined
  /**
   * How the import source captured this pick. A durable OS ref sets
   * `'bookmark'` + `sourceRef`; an app-staged file sets `'staged'`. Absent
   * means `'ephemeral'` (the `sourceUri` is valid only this session).
   */
  sourceKind?: ImportSourceKind
  sourceRef?: string | null
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
  // Photo-library candidates skip the magic-byte sniff: the filename is
  // authoritative for library assets, and the sniff can't open Android media
  // paths anyway (EACCES per asset). The scanner re-sniffs the LOCAL copy for
  // octet-stream rows after the copy.
  opts: { sniffBytes: boolean } = { sniffBytes: true },
): Promise<ParsedAssetMetadata> {
  const ts = new Date(asset.timestamp ?? Date.now()).getTime()
  return {
    name: asset.name ?? defaultFileName,
    createdAt: ts,
    updatedAt: ts,
    type: await getMimeType({
      type: asset.type,
      name: asset.name,
      uri: opts.sniffBytes ? asset.sourceUri : undefined,
    }),
  }
}

// Resolved before create so the import row targets the right directory atomically.
async function resolveImportDirectoryId(): Promise<string | null> {
  const photoImportDir = await app().settings.getPhotoImportDirectory()
  if (!photoImportDir) return null
  const dir = await app().directories.getOrCreateAtPath(photoImportDir)
  return dir.id
}

function buildImportFileRow(params: {
  importId: string
  directoryId: string | null
  name: string
  type: string
  size: number
  createdAt: number
  updatedAt: number
  now: number
  mediaAssetId: string | null
  sourceKind: ImportSourceKind
  sourceUri: string | null
  sourceRef?: string | null
}): ImportFileRow {
  return {
    id: uniqueId(),
    importId: params.importId,
    state: 'pending',
    reason: null,
    name: params.name,
    type: params.type,
    size: params.size,
    hash: null,
    createdAt: params.createdAt,
    updatedAt: params.updatedAt,
    addedAt: params.now,
    directoryId: params.directoryId,
    mediaAssetId: params.mediaAssetId,
    sourceKind: params.sourceKind,
    sourceUri: params.sourceUri,
    sourceRef: params.sourceRef ?? null,
    copyBytes: 0,
    attempts: 0,
    nextAttemptAt: 0,
    claimedAt: null,
    claimToken: null,
  }
}

export type ImportFilesOptions = {
  /** Folder the picker was opened from. New files land here directly. Defaults to root (null). */
  destinationDirectoryId?: string | null
  /** Tag to attach to every newly imported file. Used when the picker was opened from a tag's view. */
  assignTagName?: string
}

export type ImportAssetsResult = {
  /** The import row id created for this batch (null when nothing was staged). */
  importId: string | null
  /** How many picks share a name with an existing current file in the
   * destination directory and therefore will become a new version of it. */
  newVersionCount: number
}

/**
 * Picker / camera / share: opens a one-shot `sealed=1` import and stages one
 * `pending` import_files row per pick. The scanner copies bytes from
 * sourceUri, hashes, and finalizes asynchronously; this returns as soon as
 * the rows are staged.
 *
 * mediaAssetId is NULL for the entire picker family regardless of the
 * picker-supplied Asset.id: the in-app camera writes a temp file (not a
 * library asset), and picker/share imports must stay re-importable.
 * dedupByHash=0 so same-hash content coexists; same-name still versions via
 * finalize's recalculateCurrentForGroup. newVersionCount drives a
 * "+N versions" toast.
 */
export async function importAssets(
  assets: Asset[] | undefined,
  defaultFileName: string = 'file',
  options: ImportFilesOptions = {},
  source: ImportSource = 'picker',
): Promise<ImportAssetsResult> {
  const { destinationDirectoryId = null, assignTagName } = options
  const now = Date.now()

  // Picker double-pick guard: drop exact-duplicate picks by sourceUri within
  // this single action. Catches accidental double-taps without hashing; a
  // deliberate cross-session re-import of the same file still versions.
  const seenUris = new Set<string>()
  const picks = (assets ?? []).filter((a) => {
    if (!a.sourceUri) return false
    if (seenUris.has(a.sourceUri)) return false
    seenUris.add(a.sourceUri)
    return true
  })
  if (picks.length === 0) {
    return { importId: null, newVersionCount: 0 }
  }

  // parseAssetMetadata can be slow (large picker batches, share-extension
  // files); an iOS background landing mid-flight would fast-reject the first DB
  // read. Gate so the import resumes after the gate reopens.
  await app().db.waitUntilActive()

  const importId = uniqueId()
  const parsed = await Promise.all(picks.map((a) => parseAssetMetadata(a, defaultFileName)))
  const rows: ImportFileRow[] = picks.map((a, i) => {
    const meta = parsed[i]
    return buildImportFileRow({
      importId,
      directoryId: destinationDirectoryId,
      name: meta.name,
      type: meta.type,
      // Provisional: Android often reports the wrong size at import.
      // Corrected after copy (fs.copyFile) and again from the SDK at upload.
      size: a.size ?? 0,
      createdAt: meta.createdAt,
      // Bump updatedAt so a re-import wins the current-version recalc against an
      // existing row with the same (name, directory).
      updatedAt: now,
      now,
      mediaAssetId: null,
      // An untagged pick is 'ephemeral' because no durable handle was
      // captured, not as a silent default; its sourceUri is valid only this
      // process run.
      sourceKind: a.sourceKind ?? 'ephemeral',
      sourceUri: a.sourceUri ?? null,
      sourceRef: a.sourceRef ?? null,
    })
  })

  const uniqueNames = Array.from(new Set(rows.map((r) => r.name)))
  const existingCurrent = await app().files.getCurrentByNamesInDirectory(
    uniqueNames,
    destinationDirectoryId,
  )
  const existingNames = new Set(existingCurrent.map((f) => f.name))
  const newVersionCount = rows.reduce((n, r) => (existingNames.has(r.name) ? n + 1 : n), 0)

  const importRow: ImportRow = {
    id: importId,
    source,
    directoryId: destinationDirectoryId,
    pendingTags: assignTagName ? JSON.stringify([assignTagName]) : null,
    expectedCount: rows.length,
    dedupByHash: 0,
    dirSourceRef: null,
    sealed: 1,
    startedAt: now,
    updatedAt: now,
  }

  await app().imports.create(importRow, rows)
  return { importId, newVersionCount }
}

/**
 * Shared candidate builder for the two photo features (new-photos and
 * library-scan). Dedups the assets by `mediaAssetId` against both
 * import_files and files within the target directory, then returns `pending`
 * rows for the survivors with `mediaAssetId=asset.id` and
 * `sourceUri=asset.uri`. The caller owns creating, appending to, and sealing
 * the import row, and its source/policy fields.
 */
export async function buildPhotoCandidateRows(
  assets: Asset[],
  importId: string,
  directoryId: string | null,
  now: number,
): Promise<ImportFileRow[]> {
  const withAssetIds = assets.filter((a): a is Asset & { id: string } => !!a.id)
  if (withAssetIds.length === 0) return []

  // Identity dedup: skip assets already imported into this directory: any of
  // pending/active/added/duplicate in import_files, or a finalized files row
  // (including tombstoned). unavailable/failed/cancelled rows fall through
  // and re-import.
  const alreadyImported = await app().imports.getByMediaAssetIds(
    withAssetIds.map((a) => a.id),
    directoryId,
  )
  const survivors = withAssetIds.filter((a) => !alreadyImported.has(a.id))
  if (survivors.length === 0) return []

  const parsed = await Promise.all(
    survivors.map((a) => parseAssetMetadata(a, 'file', { sniffBytes: false })),
  )
  // Size HINTS in one native batch (MediaStore SIZE / PhotoKit resource
  // metadata, no bytes touched, no iCloud download). They feed the progress
  // throttle's delta gate and the open import's totals; the copy re-measures the
  // real size. Unknown (null) stays 0, which every consumer treats as "no hint".
  let sizeHints: Record<string, number | null> = {}
  const unsized = survivors.filter((a) => !a.size).map((a) => a.id)
  if (unsized.length > 0 && isNativeAvailable()) {
    try {
      sizeHints = await getAssetSizes(unsized)
    } catch (e) {
      logger.debug('assetImports', 'size_hints_failed', { error: e as Error })
    }
  }
  return survivors.map((a, i) => {
    const meta = parsed[i]
    return buildImportFileRow({
      importId,
      directoryId,
      name: meta.name,
      type: meta.type,
      size: a.size ?? sizeHints[a.id] ?? 0,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      now,
      mediaAssetId: a.id,
      // Photo assets re-resolve from the media library by mediaAssetId, durable across restart.
      sourceKind: 'media',
      sourceUri: a.sourceUri ?? null,
    })
  })
}

export { resolveImportDirectoryId }
