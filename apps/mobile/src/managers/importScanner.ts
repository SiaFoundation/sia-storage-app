import type { ImportFileRow, ImportRow } from '@siastorage/core/db/operations'
import { createServiceInterval } from '@siastorage/core/lib/serviceInterval'
import {
  ImportScanner,
  type ImportScannerResult,
  type ResolveSourceResult,
} from '@siastorage/core/services/importScanner'
import { logger } from '@siastorage/logger'
import RNFS from 'react-native-fs'
import { calculateContentHash } from '../lib/contentHash'
import { getMimeType } from '../lib/fileTypes'
import { getMediaLibraryUri } from '../lib/mediaLibrary'
import { SourceRefs } from '../lib/sourceRefs'
import { app } from '../stores/appService'
import { isBgTaskActive } from './bgTaskContext'
import { triggerThumbnailScanner } from './thumbnailScanner'

const IMPORT_SCANNER_INTERVAL = 3_000 // 3 seconds

const scanner = new ImportScanner()

function toPath(uri: string): string {
  return uri.startsWith('file://') ? decodeURIComponent(uri.slice('file://'.length)) : uri
}

async function localFileExists(uri: string | null): Promise<boolean> {
  if (!uri) return false
  try {
    return await RNFS.exists(toPath(uri))
  } catch {
    return false
  }
}

/** Coded resolve failures map to row outcomes in one place: a revoked grant
 * backs off (the user can fix it), a gone provider row is terminal. */
function mapResolveError(e: unknown): ResolveSourceResult {
  const code = (e as { code?: string })?.code
  if (code === 'deleted') return { status: 'deleted' }
  if (code === 'permission-denied') return { status: 'unavailable', code: 'permission-denied' }
  return { status: 'unavailable', code: 'resolver-error' }
}

/**
 * Bookmark kind: resolve the durable per-file ref, opening its security
 * scope for the copy window; `release` closes the scope on success, throw,
 * and suspend alike. A stale but resolvable bookmark is refreshed while the
 * scope is open and saved to the row; the save only lands if the row's claim
 * token still matches, so a refresh left over from a reclaimed row can't
 * overwrite the new owner's ref. The native module never refreshes a ref
 * silently.
 */
async function resolveBookmark(
  row: ImportFileRow,
  claimToken: string,
): Promise<ResolveSourceResult> {
  if (!row.sourceRef) return { status: 'deleted' }
  const ref = row.sourceRef
  try {
    const { uri, stale } = await SourceRefs.startAccess(ref)
    if (stale) {
      try {
        const fresh = await SourceRefs.createFileBookmark(uri)
        await app().imports.updateSourceRef(row.id, claimToken, fresh)
      } catch (e) {
        logger.warn('importScanner', 'bookmark_refresh_failed', {
          fileId: row.id,
          error: e as Error,
        })
      }
    }
    return { status: 'resolved', uri, release: () => SourceRefs.stopAccess(ref) }
  } catch (e) {
    return mapResolveError(e)
  }
}

// Dir scopes opened this scan: one scope per folder per tick, closed after
// runScan in a finally (per-row release would thrash open/close across a
// folder's children). Cleared even on throw/abort.
const openedDirScopes = new Set<string>()

/**
 * Dir-child kind: a folder pick's child, inheriting the import's one
 * `dirSourceRef` (`sourceUri` is the child key). A child-level failure fails
 * only that child; a dir-grant failure fails every child together.
 */
async function resolveDirChild(row: ImportFileRow, imp: ImportRow): Promise<ResolveSourceResult> {
  if (!imp.dirSourceRef || !row.sourceUri) return { status: 'deleted' }
  const dirRef = imp.dirSourceRef
  try {
    const { uri } = await SourceRefs.startAccessChild(dirRef, row.sourceUri)
    openedDirScopes.add(dirRef)
    return { status: 'resolved', uri }
  } catch (e) {
    return mapResolveError(e)
  }
}

/**
 * Release a row's Android persistable grant as soon as it succeeds: the
 * bytes are local, so the grant is no longer needed (no-op on iOS and other
 * kinds). `dir-child` rows share the import-level tree grant, released when
 * the import is deleted, not per child.
 */
async function releaseSourceGrant(row: ImportFileRow): Promise<void> {
  if (row.sourceKind === 'bookmark' && row.sourceRef) {
    await SourceRefs.releaseGrant(row.sourceRef)
  }
}

/**
 * Re-resolve an import file's source to a copyable URI by its `sourceKind`.
 * `bookmark`, `dir-child`, `staged`, and `media` resume across a kill.
 * `ephemeral` is session-only: over-budget Android picks and failed bookmark
 * creates. `path` is desktop-only,
 * never produced on mobile; handled like `staged` for exhaustiveness.
 */
export async function resolveSource(
  row: ImportFileRow,
  imp: ImportRow,
  claimToken: string,
  opts?: { verify?: boolean },
): Promise<ResolveSourceResult> {
  switch (row.sourceKind) {
    case 'bookmark':
      return resolveBookmark(row, claimToken)
    case 'dir-child':
      return resolveDirChild(row, imp)
    case 'media': {
      if (!row.mediaAssetId) return { status: 'deleted' }
      // Every media copy reads through the native reader, which selects the
      // resource by an explicit policy and reports which one it took. Routing
      // some assets elsewhere would let two devices copy different bytes for
      // the same photo, and content hash is the only cross-device identity
      // (mediaAssetId is device-local), so they would import as two files.
      // deleted/iCloud/permission outcomes surface as coded errors at copy
      // time and classify there.
      if (!opts?.verify) {
        return { status: 'resolved', uri: `asset://${row.mediaAssetId}` }
      }
      // A verify re-check has to probe the asset, and `asset://` defers all
      // existence checks to copy time, which would make the deleted re-verify
      // vacuous. This branch only reads `status`; it never yields copied bytes.
      const result = await getMediaLibraryUri(row.mediaAssetId)
      if (result.status === 'unavailable') return { status: 'unavailable', code: 'cloud-pending' }
      return result
    }
    case 'staged':
    case 'path':
      // A durable local file (app-owned `staged`, or a desktop user `path`):
      // resolved while present, deleted once gone.
      if (!row.sourceUri) return { status: 'deleted' }
      return (await localFileExists(row.sourceUri))
        ? { status: 'resolved', uri: row.sourceUri }
        : { status: 'deleted' }
    case 'ephemeral':
      // Session-only URI: valid only this process run. A file:// path that
      // no longer exists means the session expired (process kill), so mark
      // it deleted immediately as session-expired instead of burning the
      // retry schedule. content:// ephemerals can't be existence-checked
      // here (RNFS.exists is a java.io.File probe); their expiry classifies
      // at copy time.
      if (!row.sourceUri) return { status: 'deleted' }
      if (row.sourceUri.startsWith('file://') && !(await localFileExists(row.sourceUri))) {
        return { status: 'deleted', code: 'session-expired' }
      }
      return { status: 'resolved', uri: row.sourceUri }
  }
}

function ensureInitialized(): void {
  if (scanner.isInitialized()) return
  scanner.initialize(app(), calculateContentHash, getMimeType, resolveSource, releaseSourceGrant)
}

export async function runImportScanner(signal?: AbortSignal): Promise<ImportScannerResult> {
  ensureInitialized()
  try {
    const result = await scanner.runScan(signal)
    if (result.finalized > 0) {
      triggerThumbnailScanner()
    }
    return result
  } finally {
    // Close the tick's dir scopes on success, throw, and abort alike.
    for (const dirRef of openedDirScopes) {
      await SourceRefs.stopAccessDir(dirRef)
    }
    openedDirScopes.clear()
  }
}

async function run(signal: AbortSignal): Promise<number | undefined> {
  // BGAppRefreshTask still enforces iOS's 80%/60s CPU monitor; hashing
  // here can trip cpu_resource_fatal. See bgTaskContext.ts.
  if (isBgTaskActive('BGAppRefreshTask')) {
    logger.debug('importScanner', 'skipped', { reason: 'bg_app_refresh_no_cpu_budget' })
    return
  }
  if (app().sync.getState().syncGateStatus === 'active') {
    logger.debug('importScanner', 'skipped', { reason: 'sync_gate_active' })
    return
  }
  const result = await runImportScanner(signal)
  // Drain mode: if this tick finalized files, more work is likely pending
  // behind IMPORT_MAX_PER_TICK, so re-run immediately. Ticks that only
  // skipped or backed off fall back to the regular interval so we don't spin.
  if (result.finalized > 0) {
    return 0
  }
  return undefined
}

export const { init: initImportScanner, triggerNow: triggerImportScanner } = createServiceInterval({
  name: 'importScanner',
  worker: run,
  interval: IMPORT_SCANNER_INTERVAL,
})
