import { IMPORT_SCANNER_BACKLOG_LIMIT, IMPORT_SCANNER_INTERVAL } from '@siastorage/core/config'
import { createServiceInterval } from '@siastorage/core/lib/serviceInterval'
import { ImportScanner, type ImportScannerResult } from '@siastorage/core/services/importScanner'
import { logger } from '@siastorage/logger'
import { calculateContentHash } from '../lib/contentHash'
import { getMimeType } from '../lib/fileTypes'
import { getMediaLibraryUri } from '../lib/mediaLibrary'
import { app } from '../stores/appService'
import { isBgTaskActive } from './bgTaskContext'
import { triggerThumbnailScanner } from './thumbnailScanner'

const scanner = new ImportScanner()

function ensureInitialized(): void {
  if (scanner.isInitialized()) return
  scanner.initialize(app(), calculateContentHash, getMimeType)
}

/**
 * Computes how many placeholder files (from catalogAssets) the scanner
 * should finalize this tick. When the upload backlog is full, returns 0
 * so the scanner stops copying new photos and avoids filling device
 * storage.
 */
async function computeMaxDeferred(): Promise<number> {
  const indexerURL = await app().settings.getIndexerURL()
  const pendingUpload = await app().files.queryCount({
    order: 'ASC',
    pinned: { indexerURL, isPinned: false },
    fileExistsLocally: true,
    includeThumbnails: true,
    includeOldVersions: true,
    hashNotEmpty: true,
  })
  const maxDeferred =
    pendingUpload >= IMPORT_SCANNER_BACKLOG_LIMIT ? 0 : IMPORT_SCANNER_BACKLOG_LIMIT - pendingUpload
  logger.debug('importScanner', 'backpressure', {
    pendingUpload,
    limit: IMPORT_SCANNER_BACKLOG_LIMIT,
    maxDeferred,
  })
  return maxDeferred
}

export async function runImportScanner(signal?: AbortSignal): Promise<ImportScannerResult> {
  ensureInitialized()
  const maxDeferred = await computeMaxDeferred()
  const result = await scanner.runScan(signal, getMediaLibraryUri, maxDeferred)
  if (result.finalized > 0) {
    triggerThumbnailScanner()
  }
  return result
}

export function getImportBackoffEntries() {
  return scanner.getBackoffEntries()
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
  // Drain mode: if this tick finalized files (or files are mid-copy,
  // surfaced as skipped via the in-flight set), more work is likely
  // pending — re-run immediately instead of waiting the full interval.
  if (result.finalized > 0 || result.skipped > 0) {
    return 0
  }
  return undefined
}

export const { init: initImportScanner, triggerNow: triggerImportScanner } = createServiceInterval({
  name: 'importScanner',
  worker: run,
  interval: IMPORT_SCANNER_INTERVAL,
})

export function retryImportFile(id: string): void {
  scanner.clearBackoff(id)
  triggerImportScanner()
}

export function retryAllImportFiles(): void {
  scanner.clearAllBackoff()
  triggerImportScanner()
}

export function markImportCopyStarted(fileId: string): void {
  scanner.markCopyStarted(fileId)
}

export function markImportCopyComplete(fileId: string): void {
  scanner.markCopyComplete(fileId)
}
