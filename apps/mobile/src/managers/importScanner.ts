import {
  IMPORT_SCANNER_BACKLOG_LIMIT,
  IMPORT_SCANNER_INTERVAL,
} from '@siastorage/core/config'
import { createServiceInterval } from '@siastorage/core/lib/serviceInterval'
import {
  ImportScanner,
  type ImportScannerResult,
} from '@siastorage/core/services/importScanner'
import { calculateContentHash } from '../lib/contentHash'
import { getMimeType } from '../lib/fileTypes'
import { getMediaLibraryUri } from '../lib/mediaLibrary'
import { app } from '../stores/appService'

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
    activeOnly: true,
    hashNotEmpty: true,
  })
  if (pendingUpload >= IMPORT_SCANNER_BACKLOG_LIMIT) return 0
  return IMPORT_SCANNER_BACKLOG_LIMIT - pendingUpload
}

export async function runImportScanner(
  signal?: AbortSignal,
): Promise<ImportScannerResult> {
  ensureInitialized()
  const maxDeferred = await computeMaxDeferred()
  return scanner.runScan(signal, getMediaLibraryUri, maxDeferred)
}

export const { init: initImportScanner, triggerNow: triggerImportScanner } =
  createServiceInterval({
    name: 'importScanner',
    worker: async (signal) => {
      await runImportScanner(signal)
    },
    interval: IMPORT_SCANNER_INTERVAL,
  })
