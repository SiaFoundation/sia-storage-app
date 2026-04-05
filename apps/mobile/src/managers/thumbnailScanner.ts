import { THUMBNAIL_SCANNER_INTERVAL } from '@siastorage/core/config'
import { createServiceInterval } from '@siastorage/core/lib/serviceInterval'
import {
  ThumbnailScanner,
  type ThumbnailScannerResult,
} from '@siastorage/core/services/thumbnailScanner'
import { logger } from '@siastorage/logger'
import { app } from '../stores/appService'

const scanner = new ThumbnailScanner()

export function getThumbnailScanner(): ThumbnailScanner {
  ensureInitialized()
  return scanner
}

function ensureInitialized(): void {
  if (scanner.isInitialized()) return
  scanner.initialize(app())
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

async function run(signal: AbortSignal): Promise<void> {
  if (app().sync.getState().isSyncingDown) {
    logger.debug('thumbnailScanner', 'skipped', { reason: 'syncing_down' })
    return
  }
  await runThumbnailScanner(signal)
}

export const { init: initThumbnailScanner } = createServiceInterval({
  name: 'thumbnailScanner',
  worker: run,
  interval: THUMBNAIL_SCANNER_INTERVAL,
})
