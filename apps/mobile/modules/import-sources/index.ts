import { requireOptionalNativeModule } from 'expo'
import { Platform } from 'react-native'

/**
 * Native access to import sources: durable OS refs (iOS security-scoped
 * bookmarks, Android persistable grants), a copy that also hashes, photo
 * library asset reads with progress, and the open-in-place file picker.
 *
 * This file is the package's entire public TS surface and the only place the
 * native modules are looked up; nothing under `src/` imports `'expo'`. It is
 * also the one place hashes are normalized: native returns bare hex and this
 * file lowercases it and prefixes `sha256:`, so every other consumer passes
 * hashes through untouched.
 */

/** Tagged opaque durable ref: `ios-bm:<base64>` or `android-uri:<uri>`. */
export type SourceRef = string

export type StartAccessResult = {
  uri: string
  /** iOS only: the bookmark resolved but the caller should refresh it. */
  stale: boolean
}

export type DirEntry = { name: string; key: string; size: number; type: string }

export type CopyToPathResult = { size: number; sha256: string; mime?: string }

export type CopyAssetResult = {
  size: number
  sha256: string
  mime: string
  variant: 'original' | 'rendered'
}

export type CopyProgressEvent = {
  copyId: string
  bytesCopied: number
  totalBytes: number | null
  fraction: number | null
}

export type PickedFile = {
  uri: string
  name: string
  size?: number
  mimeType?: string
  lastModified?: number
}

export type CreateBookmarkResult = { ref: SourceRef } | { code: string }

export type Subscription = { remove(): void }

/**
 * Every code the native modules can throw (`error.code` on the rejection).
 * Every code except `cancelled` is a core import reason code; `cancelled`
 * maps to the cancelled import-file state, not a failure reason.
 */
export const IMPORT_SOURCES_ERROR_CODES = [
  'deleted',
  'permission-denied',
  'cloud-download-failed',
  'source-pending',
  'not-enough-space',
  'not-persistable',
  'io-error',
  'cancelled',
  'unsupported',
] as const

export const IMPORT_SOURCES_UNAVAILABLE = 'import-sources-unavailable'

type NativeRefs = {
  createFileBookmarks(uris: string[]): Promise<CreateBookmarkResult[]>
  createDirBookmark(uri: string): Promise<string>
  startAccess(ref: string): Promise<StartAccessResult>
  startAccessChild(dirRef: string, key: string): Promise<{ uri: string }>
  stopAccess(ref: string): Promise<void>
  stopAccessDir(dirRef: string): Promise<void>
  enumerateDir(dirRef: string): Promise<DirEntry[]>
  copyToPath(
    srcUri: string,
    destPath: string,
    copyId: string | null,
  ): Promise<{ size: number; sha256: string; mime?: string }>
  releaseGrant(ref: string): Promise<void>
  grantBudgetRemaining(): Promise<number>
  pickFiles(): Promise<PickedFile[]>
}

type NativeReader = {
  copyAsset(
    assetId: string,
    destPath: string,
    copyId: string,
  ): Promise<{ size: number; sha256: string; mime: string; variant: 'original' | 'rendered' }>
  cancelCopy(copyId: string): Promise<void>
  getSizes(assetIds: string[]): Promise<Record<string, number | null>>
  addListener(event: 'copyProgress', cb: (e: CopyProgressEvent) => void): Subscription
}

const refs = requireOptionalNativeModule<NativeRefs>('ImportSourceRefs')
const reader = requireOptionalNativeModule<NativeReader>('MediaAssetReader')

/** Whether the native module is present in this build. */
export function isNativeAvailable(): boolean {
  return refs !== null
}

function unavailable(): Error & { code: string } {
  const e = new Error('import-sources: native module missing') as Error & { code: string }
  e.code = IMPORT_SOURCES_UNAVAILABLE
  return e
}

function requireRefs(): NativeRefs {
  if (!refs) throw unavailable()
  return refs
}

function requireReader(): NativeReader {
  if (!reader) throw unavailable()
  return reader
}

const withSha256Prefix = <T extends { sha256: string }>(r: T): T => ({
  ...r,
  sha256: `sha256:${r.sha256.toLowerCase()}`,
})

/** Create durable refs for all picked uris in one native call; a per-uri
 * failure lands as `{ code }` in its slot and never rejects the batch. */
export async function createFileBookmarks(uris: string[]): Promise<CreateBookmarkResult[]> {
  if (uris.length === 0) return []
  return requireRefs().createFileBookmarks(uris)
}

export async function createFileBookmark(uri: string): Promise<SourceRef> {
  const [result] = await createFileBookmarks([uri])
  if ('ref' in result) return result.ref
  const e = new Error(`import-sources: bookmark creation failed (${result.code})`) as Error & {
    code: string
  }
  e.code = result.code
  throw e
}

export async function createDirBookmark(uri: string): Promise<SourceRef> {
  return requireRefs().createDirBookmark(uri)
}

export async function startAccess(ref: SourceRef): Promise<StartAccessResult> {
  return requireRefs().startAccess(ref)
}

export async function startAccessChild(dirRef: SourceRef, key: string): Promise<{ uri: string }> {
  return requireRefs().startAccessChild(dirRef, key)
}

export async function stopAccess(ref: SourceRef): Promise<void> {
  await requireRefs().stopAccess(ref)
}

export async function stopAccessDir(dirRef: SourceRef): Promise<void> {
  await requireRefs().stopAccessDir(dirRef)
}

export async function enumerateDir(dirRef: SourceRef): Promise<DirEntry[]> {
  return requireRefs().enumerateDir(dirRef)
}

export async function copyToPath(
  srcUri: string,
  destPath: string,
  opts?: { copyId?: string },
): Promise<CopyToPathResult> {
  return withSha256Prefix(await requireRefs().copyToPath(srcUri, destPath, opts?.copyId ?? null))
}

export async function releaseGrant(ref: SourceRef): Promise<void> {
  await requireRefs().releaseGrant(ref)
}

export async function grantBudgetRemaining(): Promise<number> {
  return requireRefs().grantBudgetRemaining()
}

export async function copyAsset(
  assetId: string,
  destPath: string,
  opts: { copyId: string },
): Promise<CopyAssetResult> {
  return withSha256Prefix(await requireReader().copyAsset(assetId, destPath, opts.copyId))
}

export async function cancelCopy(copyId: string): Promise<void> {
  await requireReader().cancelCopy(copyId)
}

/**
 * Batched byte-size hints for library assets, read from metadata only
 * (MediaStore SIZE, PhotoKit resource metadata), never a download; an
 * unknown size comes back null. The hints feed progress totals and copy
 * scheduling; the copy re-measures the authoritative size from the
 * streamed bytes.
 */
export async function getAssetSizes(assetIds: string[]): Promise<Record<string, number | null>> {
  if (assetIds.length === 0) return {}
  return requireReader().getSizes(assetIds)
}

export function addCopyProgressListener(cb: (e: CopyProgressEvent) => void): Subscription {
  return requireReader().addListener('copyProgress', cb)
}

/**
 * Present the OS file picker in open-in-place mode: the returned uris point
 * at the user's original files (security-scoped; create bookmarks to keep
 * them), unlike expo-document-picker, which always copies (`asCopy: true`).
 * User dismissal resolves `[]`. iOS-only: Android keeps expo's picker, whose
 * `ACTION_OPEN_DOCUMENT` results already reference originals.
 */
export async function pickFiles(): Promise<PickedFile[]> {
  if (Platform.OS !== 'ios') {
    throw new Error('import-sources: pickFiles is iOS-only')
  }
  try {
    return await requireRefs().pickFiles()
  } catch (e) {
    if ((e as { code?: string }).code === 'cancelled') return []
    throw e
  }
}
