import { requireOptionalNativeModule } from 'expo'
import {
  type CopyAssetResult,
  type CopyProgressEvent,
  type CopyToPathResult,
  type CreateBookmarkResult,
  type DirEntry,
  IMPORT_SOURCES_UNAVAILABLE,
  type PickedFile,
  type PickedMedia,
  type SourceRef,
  type StartAccessResult,
  type Subscription,
} from './types'

export * from './types'

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
  ): Promise<{ size: number; sha256: string; headBytes?: string }>
  releaseGrant(ref: string): Promise<void>
  grantBudgetRemaining(): Promise<number>
  pickFiles(): Promise<PickedFile[]>
  pickMedia(): Promise<PickedMedia[]>
}

type NativeReader = {
  copyAsset(
    assetId: string,
    destPath: string,
    copyId: string,
  ): Promise<{ size: number; sha256: string; mime: string; variant: 'original' | 'rendered' }>
  cancelCopy(copyId: string): Promise<void>
  getSizes(assetIds: string[]): Promise<Record<string, number | null>>
  deleteAssets(assetIds: string[]): Promise<boolean>
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
  const { headBytes, ...rest } = withSha256Prefix(
    await requireRefs().copyToPath(srcUri, destPath, opts?.copyId ?? null),
  )
  // Base64 on the wire; JS-side consumers want bytes.
  return headBytes ? { ...rest, headerBytes: base64ToBytes(headBytes) } : rest
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = globalThis.atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
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

/** Remove assets from Apple Photos. iOS presents its standard confirmation sheet. */
export async function deleteMediaAssets(assetIds: string[]): Promise<boolean> {
  if (assetIds.length === 0) return true
  return requireReader().deleteAssets(assetIds)
}

export function addCopyProgressListener(cb: (e: CopyProgressEvent) => void): Subscription {
  return requireReader().addListener('copyProgress', cb)
}

/**
 * Present the OS file picker over the user's original files, so no bytes
 * are copied at pick time (expo-document-picker always copies on iOS,
 * `asCopy: true`). iOS opens in place with security scopes and mints a
 * bookmark per pick (`ref`); Android fires ACTION_OPEN_DOCUMENT and the
 * caller persists grants afterward. User dismissal resolves `[]`.
 */
export async function pickFiles(): Promise<PickedFile[]> {
  try {
    return await requireRefs().pickFiles()
  } catch (e) {
    if ((e as { code?: string }).code === 'cancelled') return []
    throw e
  }
}

/**
 * Present the system photo picker with no byte export. Android returns the
 * Photo Picker's content uris, streamed by the scanner for the one and only
 * copy (picker grants are session-only, so those rows stage ephemeral). iOS
 * returns PHAsset identifiers that stage as media rows, the same byte path
 * as the photo-library sync. User dismissal resolves `[]`.
 */
export async function pickMedia(): Promise<PickedMedia[]> {
  try {
    return await requireRefs().pickMedia()
  } catch (e) {
    if ((e as { code?: string }).code === 'cancelled') return []
    throw e
  }
}
