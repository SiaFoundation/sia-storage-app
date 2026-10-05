import { logger } from '@siastorage/logger'
import type { AppService } from '../app/service'

/**
 * Keeps each latest link on its files' current versions, attaches a snapshot
 * link's files as their uploads finish, takes files off links while they are
 * trashed, and picks up links made, changed or revoked on other devices. Scheduled on
 * SHARE_LINKS_INTERVAL. A failed pass is logged and the next one tries again.
 */
export async function runShareLinkSync(app: AppService): Promise<void> {
  if (!app.connection.getState().isConnected) {
    logger.debug('shareLinks', 'skipped', { reason: 'not_connected' })
    return
  }
  try {
    await app.shares.syncLinks()
  } catch (e) {
    logger.warn('shareLinks', 'sync_failed', { error: e as Error })
  }
}
