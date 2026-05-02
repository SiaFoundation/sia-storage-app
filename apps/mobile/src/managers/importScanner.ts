import { IMPORT_SCANNER_BACKLOG_LIMIT, IMPORT_SCANNER_INTERVAL } from '@siastorage/core/config'
import { createServiceInterval } from '@siastorage/core/lib/serviceInterval'
import { ImportScanner, type ImportScannerResult } from '@siastorage/core/services/importScanner'
import { logger } from '@siastorage/logger'
import { calculateContentHash } from '../lib/contentHash'
import { getMimeType } from '../lib/fileTypes'
import { getMediaLibraryUri } from '../lib/mediaLibrary'
import { app } from '../stores/appService'
import { isBgTaskActive } from './bgTaskContext'

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
  return scanner.runScan(signal, getMediaLibraryUri, maxDeferred)
}

export function getImportBackoffEntries() {
  return scanner.getBackoffEntries()
}

async function run(signal: AbortSignal): Promise<void> {
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
  await runImportScanner(signal)
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
