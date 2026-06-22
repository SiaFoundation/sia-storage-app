import { logger } from '@siastorage/logger'
import type { AppService, AppServiceInternal } from '../app/service'

/**
 * Ask the indexer to unpin slabs no longer referenced by any object, reclaiming
 * the storage that deleted files leave behind.
 *
 * We always call prune rather than checking first whether anything is
 * reclaimable: the indexer runs that check as prune's first step and returns
 * fast when there's nothing to do. A client-side size comparison can't work
 * anyway — the account reports slab capacity, not file bytes — so callers just
 * keep the cadence slow.
 */
export async function runPruneSlabs(app: AppService, internal: AppServiceInternal): Promise<void> {
  if (!app.connection.getState().isConnected) {
    logger.debug('pruneSlabs', 'skipped', { reason: 'not_connected' })
    return
  }
  try {
    await internal.requireSdk().pruneSlabs()
    logger.info('pruneSlabs', 'pruned')
  } catch (e) {
    logger.warn('pruneSlabs', 'prune_failed', { error: e as Error })
  }
}
