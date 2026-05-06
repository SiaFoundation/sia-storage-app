import { THUMBNAIL_SCANNER_INTERVAL } from '@siastorage/core/config'
import { createServiceInterval } from '@siastorage/core/lib/serviceInterval'
import {
  ThumbnailScanner,
  type ThumbnailScannerResult,
} from '@siastorage/core/services/thumbnailScanner'
import { logger } from '@siastorage/logger'
import { app } from '../stores/appService'

const scanner = new ThumbnailScanner()

// After this many consecutive ticks with zero candidates, the scanner
// slows its polling cadence. Reset on triggerNow / new imports.
const IDLE_BACKOFF_THRESHOLD = 3
const IDLE_BACKOFF_INTERVAL_MS = 30_000
const IDLE_STEADY_INTERVAL_MS = 60_000
const IDLE_STEADY_THRESHOLD = 6

let consecutiveZeroTicks = 0

export function getThumbnailScanner(): ThumbnailScanner {
  ensureInitialized()
  return scanner
}

function ensureInitialized(): void {
  if (scanner.isInitialized()) return
  scanner.initialize(app())
}

export function resetThumbnailScannerBackoff(): void {
  consecutiveZeroTicks = 0
}

export async function runThumbnailScanner(signal?: AbortSignal): Promise<ThumbnailScannerResult> {
  ensureInitialized()
  const result = await scanner.runScan(signal)
  if (result.produced.length > 0) {
    await app().caches.library.invalidateAll()
    app().caches.libraryVersion.invalidate()
  }
  return result
}

function resultSawWork(result: ThumbnailScannerResult): boolean {
  return (
    result.processedCandidates > 0 ||
    result.produced.length > 0 ||
    result.attempts.length > 0 ||
    result.skippedNoSource.length > 0 ||
    result.skippedFullyCovered.length > 0 ||
    result.skippedErrorCooldown.length > 0 ||
    result.errors.length > 0
  )
}

export function nextIdleInterval(zeroTicks: number): number | undefined {
  if (zeroTicks >= IDLE_STEADY_THRESHOLD) return IDLE_STEADY_INTERVAL_MS
  if (zeroTicks >= IDLE_BACKOFF_THRESHOLD) return IDLE_BACKOFF_INTERVAL_MS
  return undefined
}

async function run(signal: AbortSignal): Promise<number | void> {
  // Hard gate: hold off for the entire initial sync window so we don't
  // generate thumbs locally for files whose remote thumbnails are about
  // to land in the same catch-up.
  if (app().sync.getState().syncGateStatus === 'active') {
    logger.debug('thumbnailScanner', 'skipped', { reason: 'sync_gate_active' })
    return
  }
  // Per-tick gate: a sync-down batch is mid-flight — skip thumbnail
  // generation while sync-down is writing, just for resource coordination.
  if (app().sync.getState().isSyncingDown) {
    logger.debug('thumbnailScanner', 'skipped', { reason: 'syncing_down' })
    return
  }
  const result = await runThumbnailScanner(signal)
  if (resultSawWork(result)) {
    consecutiveZeroTicks = 0
    return
  }
  consecutiveZeroTicks++
  return nextIdleInterval(consecutiveZeroTicks)
}

const scannerInterval = createServiceInterval({
  name: 'thumbnailScanner',
  worker: run,
  interval: THUMBNAIL_SCANNER_INTERVAL,
})

export const initThumbnailScanner = scannerInterval.init

export function triggerThumbnailScanner(): void {
  resetThumbnailScannerBackoff()
  scannerInterval.triggerNow()
}
