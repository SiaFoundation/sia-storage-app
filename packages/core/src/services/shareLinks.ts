import { logger } from '@siastorage/logger'
import type { AppService } from '../app/service'
import { OLDER_VERSION_TRASH_INTERVAL } from '../config'

/** When each app last went on to trash older versions. */
const olderVersionsTrashedAt = new WeakMap<AppService, number>()

/**
 * Keeps each latest link on its files' current versions, attaches a snapshot
 * link's files as their uploads finish, takes trashed files off links for
 * good, and picks up links made, changed or revoked on other devices. Scheduled on
 * SHARE_LINKS_INTERVAL. A failed pass is logged and the next one tries again.
 *
 * At most every OLDER_VERSION_TRASH_INTERVAL the pass also moves older
 * versions to the trash. Trashing takes a file off every link on every
 * device, and `trashOlderVersions` keeps a version a link names only when
 * this device has that link's rows, which are as current as the last listing
 * of the account's links. A plain pass lists them only every
 * SHARE_LINKS_REFRESH_INTERVAL, so this pass lists them first, and a link
 * made on another device since is known before the version it shows could
 * be trashed. A pass that fails also waits the interval, because retrying on
 * every pass would list the account's links every SHARE_LINKS_INTERVAL for as
 * long as it keeps failing.
 */
export async function runShareLinkSync(app: AppService): Promise<void> {
  if (!app.connection.getState().isConnected) {
    logger.debug('shareLinks', 'skipped', { reason: 'not_connected' })
    return
  }
  const now = Date.now()
  const last = olderVersionsTrashedAt.get(app)
  if (last !== undefined && now - last < OLDER_VERSION_TRASH_INTERVAL) {
    try {
      await app.shares.syncLinks()
    } catch (e) {
      logger.warn('shareLinks', 'sync_failed', { error: e as Error })
    }
    return
  }
  olderVersionsTrashedAt.set(app, now)
  try {
    await app.shares.syncLinksAndTrashOlderVersions()
  } catch (e) {
    logger.warn('shareLinks', 'sync_and_trash_failed', { error: e as Error })
  }
}
