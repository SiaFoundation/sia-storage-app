import type { DownloadEntry } from '@siastorage/core/app'
import type { LocalObjectRef } from '@siastorage/core/encoding/localObject'
import { useDownloadEntry } from '@siastorage/core/stores'
import type { FileRecord } from '@siastorage/core/types'
import { useMemo } from 'react'
import useSWR from 'swr'
import { getMediaLibraryDisplayUri } from './mediaLibrary'
import { app } from '../stores/appService'
import { useFsFileUri } from '../stores/fs'
import { type UploadState, useUploadState } from '../stores/uploads'

export function fileHasASealedObject(file?: FileRecord): boolean {
  return !!Object.keys(file?.objects ?? {}).length
}

export type FileItemProps = {
  file: FileRecord
  onPressItem: (item: FileRecord) => void
  onLongPressItem?: (item: FileRecord) => void
}

export function fileRecordEqual(a: FileRecord, b: FileRecord): boolean {
  return (
    a.id === b.id &&
    a.updatedAt === b.updatedAt &&
    a.hash === b.hash &&
    // Re-render when sealed objects change (e.g., upload completes) since
    // updatedAt doesn't change when a local object is added.
    Object.keys(a.objects).length === Object.keys(b.objects).length
  )
}

export function fileItemPropsAreEqual(prev: FileItemProps, next: FileItemProps): boolean {
  return (
    fileRecordEqual(prev.file, next.file) &&
    prev.onPressItem === next.onPressItem &&
    prev.onLongPressItem === next.onLongPressItem
  )
}

/**
 * Result of a Photos-library asset lookup for a file with a mediaAssetId:
 * - 'unknown': SWR in flight, lookup not yet resolved
 * - 'available': asset resolved with a URI a player can render (may be ph://)
 * - 'unavailable': asset is deleted or temporarily unreachable (iCloud)
 * - 'none': caller didn't opt in, or file has no mediaAssetId, no fallback exists
 */
export type PhotosLookup = 'unknown' | 'available' | 'unavailable' | 'none'

export type UploadActivity = {
  state: 'idle' | 'queued' | 'packing' | 'uploading' | 'errored'
  progress: number
}

export type DownloadActivity = {
  state: 'idle' | 'queued' | 'downloading' | 'errored'
  progress: number
}

/**
 * Orthogonal observable facts about a file. Inputs to derivePhase and
 * deriveCapabilities. No derived/aggregate booleans here.
 */
export type FileFacts = {
  isImportFailed: boolean
  isPinned: boolean
  hasLocalCopy: boolean
  photosLookup: PhotosLookup
  isShared: boolean
  upload: UploadActivity
  download: DownloadActivity
  errorText: string | null
}

/**
 * Mutually exclusive lifecycle state of a file. Every input combination
 * resolves to exactly one phase via derivePhase. Use `switch (phase.kind)`
 * with assertNever to make consumers exhaustive.
 */
export type FilePhase =
  | { kind: 'import-failed'; reason: string }
  | { kind: 'uploading'; progress: number; isPacking: boolean; isQueued: boolean }
  | { kind: 'upload-errored'; error: string | null }
  | { kind: 'downloading'; progress: number; isQueued: boolean }
  | { kind: 'pinned-and-local' }
  | { kind: 'pinned-remote-only' }
  | { kind: 'local-only' }
  | { kind: 'unavailable' }

/** Derived action gates. Computed from FileFacts; orthogonal to phase. */
export type FileCapabilities = {
  isOnNetwork: boolean
  canShare: boolean
  canDownload: boolean
  canUpload: boolean
  canPlay: boolean
  canAutoFetch: boolean
}

/**
 * Priority-ordered, total: every FileFacts maps to exactly one FilePhase.
 * Order: errors first, then in-flight ops, then steady states.
 */
export function derivePhase(facts: FileFacts): FilePhase {
  if (facts.isImportFailed) return { kind: 'import-failed', reason: facts.errorText ?? '' }
  if (facts.upload.state === 'errored' && !facts.isPinned)
    return { kind: 'upload-errored', error: facts.errorText }
  if (
    facts.upload.state === 'queued' ||
    facts.upload.state === 'packing' ||
    facts.upload.state === 'uploading'
  ) {
    return {
      kind: 'uploading',
      progress: facts.upload.progress,
      isPacking: facts.upload.state === 'packing',
      isQueued: facts.upload.state === 'queued',
    }
  }
  if (facts.download.state === 'queued' || facts.download.state === 'downloading') {
    return {
      kind: 'downloading',
      progress: facts.download.progress,
      isQueued: facts.download.state === 'queued',
    }
  }
  if (facts.isPinned && facts.hasLocalCopy) return { kind: 'pinned-and-local' }
  if (facts.isPinned && !facts.hasLocalCopy) return { kind: 'pinned-remote-only' }
  if (facts.hasLocalCopy && !facts.isPinned) return { kind: 'local-only' }
  // Terminal: hashed file with no local copy and no sealed objects. In
  // healthy operation this is unreachable — cache eviction only touches
  // pinned files (see queryEvictionCandidates) and trash/delete flows
  // filter rows out before they reach here. If a bug or external mutation
  // ever leaves a hashed file stranded, we route it here loudly. The
  // viewer still shows the original from Photos via displayUri when the
  // mediaAssetId resolves, so the user can recover by re-importing.
  return { kind: 'unavailable' }
}

export function deriveCapabilities(facts: FileFacts): FileCapabilities {
  const isOnNetwork = facts.isPinned || facts.isShared
  // Errored is treated like idle so the user can retry from the action
  // sheet; only in-flight states (queued/uploading/downloading) block.
  const downloadFree = facts.download.state === 'idle' || facts.download.state === 'errored'
  const uploadFree = facts.upload.state === 'idle' || facts.upload.state === 'errored'
  return {
    isOnNetwork,
    canShare: facts.isPinned,
    canDownload: isOnNetwork && !facts.hasLocalCopy && downloadFree,
    canUpload: facts.hasLocalCopy && !facts.isPinned && uploadFree,
    canPlay: facts.hasLocalCopy || facts.photosLookup === 'available',
    canAutoFetch: isOnNetwork && !facts.hasLocalCopy,
  }
}

/**
 * Pure capability resolver for bulk-op call sites that don't have an SWR
 * context. Assumes idle upload/download state, no Photos backup, no share.
 * Use useFileStatus where a hook is available — this is for loops that
 * iterate raw FileRecords.
 */
export function getFileCapabilities(file: FileRecord, fileUri: string | null): FileCapabilities {
  return deriveCapabilities({
    isImportFailed: !!file.lostReason,
    isPinned: fileHasASealedObject(file),
    hasLocalCopy: !!fileUri,
    photosLookup: 'none',
    isShared: false,
    upload: { state: 'idle', progress: 0 },
    download: { state: 'idle', progress: 0 },
    errorText: null,
  })
}

/** Exhaustiveness guard for `switch (phase.kind)` consumers. */
export function assertNever(value: never): never {
  throw new Error(`Unhandled discriminant: ${JSON.stringify(value)}`)
}

export type FileStatus = {
  isImportFailed: boolean
  isPinned: boolean
  isOnNetwork: boolean
  isDownloaded: boolean
  /**
   * Real file:// path inside app storage. Safe for fs operations: hash,
   * copy, share, upload. Null until the file has been downloaded or the
   * import scanner has copied it in.
   */
  fileUri: string | null
  photosLookup: PhotosLookup
  /**
   * URI the Photos-library asset can be rendered with: file:// when an
   * exported localUri is available, ph:// (iOS) or file:// (Android) as a
   * display-only fallback. Display-only — never pass to fs operations,
   * share, or upload; use fileUri for those.
   */
  photosDisplayUri: string | null
  /**
   * Best URI for a player: fileUri when present, else photosDisplayUri.
   * May be ph:// — display-only, not safe for fs/share/upload. Consumers
   * doing anything other than rendering must use fileUri.
   */
  displayUri: string | null
  upload: UploadActivity
  download: DownloadActivity
  errorText: string | null
  phase: FilePhase
  canShare: boolean
  canDownload: boolean
  canUpload: boolean
  canPlay: boolean
  canAutoFetch: boolean
}

export function computeFileStatus({
  file,
  isShared,
  uploadState,
  downloadState,
  fileUri,
  photosLookup = 'none',
  photosDisplayUri = null,
  errorText,
}: {
  file?: FileRecord
  isShared?: boolean
  uploadState: UploadState | undefined
  downloadState: DownloadEntry | undefined
  fileUri: string | null
  photosLookup?: PhotosLookup
  photosDisplayUri?: string | null
  errorText: string | null
}): FileStatus {
  const isImportFailed = !!file?.lostReason
  const uploadStatus = uploadState?.status
  const hasSealedObject = fileHasASealedObject(file)
  const isDownloaded = !!fileUri
  const isPinned = hasSealedObject

  const upload: UploadActivity = {
    state:
      uploadStatus === 'queued'
        ? 'queued'
        : uploadStatus === 'packing' || uploadStatus === 'packed'
          ? 'packing'
          : uploadStatus === 'uploading'
            ? 'uploading'
            : uploadStatus === 'error'
              ? 'errored'
              : 'idle',
    progress: uploadState?.progress ?? 0,
  }
  const download: DownloadActivity = {
    state:
      downloadState?.status === 'queued'
        ? 'queued'
        : downloadState?.status === 'downloading'
          ? 'downloading'
          : downloadState?.status === 'error'
            ? 'errored'
            : 'idle',
    progress: downloadState?.progress ?? 0,
  }
  // Surface file.lostReason verbatim (e.g., "Source photo deleted from
  // device") rather than collapsing it to "Import failed". The friendly
  // label is hardcoded per phase in UploadStatusIcon; this carries detail.
  const resolvedErrorText =
    file?.lostReason ?? uploadState?.error ?? downloadState?.error ?? errorText
  const facts: FileFacts = {
    isImportFailed,
    isPinned,
    hasLocalCopy: isDownloaded,
    photosLookup,
    isShared: !!isShared,
    upload,
    download,
    errorText: resolvedErrorText,
  }
  const phase = derivePhase(facts)
  const capabilities = deriveCapabilities(facts)

  return {
    isImportFailed,
    isPinned,
    isOnNetwork: capabilities.isOnNetwork,
    isDownloaded,
    fileUri,
    photosLookup,
    photosDisplayUri,
    displayUri: fileUri ?? photosDisplayUri ?? null,
    upload,
    download,
    errorText: resolvedErrorText,
    phase,
    canShare: capabilities.canShare,
    canDownload: capabilities.canDownload,
    canUpload: capabilities.canUpload,
    canPlay: capabilities.canPlay,
    canAutoFetch: capabilities.canAutoFetch,
  }
}

export type FileStatusResponse = {
  data: FileStatus | undefined
  isLoading: boolean
}

export type UseFileStatusOptions = {
  isShared?: boolean
  /**
   * Resolve the Photos-library backup for files with a mediaAssetId. iOS
   * MediaLibrary.getAssetInfoAsync can trigger an iCloud download, so
   * gallery-style consumers must leave this off; only opt in for surfaces
   * that actually need the fallback (e.g., FileViewer).
   */
  resolvePhotosLookup?: boolean
}

export function useFileStatus(
  file?: FileRecord,
  options: UseFileStatusOptions = {},
): FileStatusResponse {
  const { isShared, resolvePhotosLookup } = options
  const uploadState = useUploadState(file?.id || '')
  const { data: downloadState } = useDownloadEntry(file?.id || '')
  const fileUri = useFsFileUri(file)

  // Only look up Photos when caller opts in AND the file has a mediaAssetId AND
  // there's no sealed-object fallback (network download is canonical when pinned).
  const hasSealed = fileHasASealedObject(file)
  const photosLocalId =
    resolvePhotosLookup && file?.mediaAssetId && !hasSealed ? file.mediaAssetId : null
  const photosSwr = useSWR(photosLocalId ? ['mediaLibraryDisplayUri', photosLocalId] : null, () =>
    getMediaLibraryDisplayUri(photosLocalId),
  )

  const photosLookup: PhotosLookup = !resolvePhotosLookup
    ? 'none'
    : !file?.mediaAssetId || hasSealed
      ? 'none'
      : !photosSwr.data && !photosSwr.error
        ? 'unknown'
        : photosSwr.data?.status === 'resolved'
          ? 'available'
          : 'unavailable'
  const photosDisplayUri = photosSwr.data?.status === 'resolved' ? photosSwr.data.uri : null

  const data = useMemo(() => {
    if (fileUri.isLoading) return undefined
    return computeFileStatus({
      file,
      isShared,
      uploadState,
      downloadState,
      fileUri: fileUri.data ?? null,
      photosLookup,
      photosDisplayUri,
      errorText: uploadState?.error || downloadState?.error || null,
    })
  }, [
    file,
    isShared,
    uploadState,
    downloadState,
    fileUri.data,
    fileUri.isLoading,
    photosLookup,
    photosDisplayUri,
  ])

  return { data, isLoading: fileUri.isLoading }
}

export type BulkCounts = {
  onNetwork: number
  downloadable: number
  uploadable: number
  total: number
  files: FileRecord[]
}

export async function fetchBulkCounts(fileIds: string[]): Promise<BulkCounts> {
  const files: FileRecord[] = []
  let onNetwork = 0
  let downloadable = 0
  let uploadable = 0

  for (const id of fileIds) {
    const file = await app().files.getById(id)
    if (file) {
      files.push(file)
      const uri = await app().fs.getFileUri(file)
      const caps = getFileCapabilities(file, uri)
      if (caps.isOnNetwork) onNetwork++
      if (caps.canDownload) downloadable++
      if (caps.canUpload) uploadable++
    }
  }

  return { onNetwork, downloadable, uploadable, total: files.length, files }
}

export function getFileTypeName(
  file: FileRecord,
): 'photo' | 'video' | 'audio' | 'document' | 'other' {
  return file.type?.startsWith('image')
    ? 'photo'
    : file.type?.startsWith('video')
      ? 'video'
      : file.type?.startsWith('audio')
        ? 'audio'
        : file.type?.startsWith('application')
          ? 'document'
          : 'other'
}

export function getOneObject(file: {
  objects: Record<string, LocalObjectRef> | null
}): { indexerURL: string; object: LocalObjectRef } | null {
  const entries = Object.entries(file.objects ?? {})
  if (entries.length === 0) return null
  const [indexerURL, object] = entries[0]
  return { indexerURL, object }
}
