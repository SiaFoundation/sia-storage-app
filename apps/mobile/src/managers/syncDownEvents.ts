import { SYNC_EVENTS_INTERVAL } from '@siastorage/core/config'
import { createServiceInterval } from '@siastorage/core/lib/serviceInterval'
import { syncDownEventsBatch } from '@siastorage/core/services/syncDownEvents'
import { logger } from '@siastorage/logger'
import { app, internal } from '../stores/appService'

export async function run(signal: AbortSignal): Promise<number | void> {
  if (!(await app().settings.getAutoSyncDownEvents())) {
    logger.debug('syncDownEvents', 'skipped', { reason: 'disabled' })
    return
  }
  if (!app().connection.getState().isConnected) {
    logger.debug('syncDownEvents', 'skipped', { reason: 'not_connected' })
    return
  }
  const sdk = internal().getSdk()
  if (!sdk) {
    logger.debug('syncDownEvents', 'skipped', { reason: 'no_sdk' })
    return
  }

  return syncDownEventsBatch(signal, app(), internal())
}

export const { init: initSyncDownEvents, triggerNow: triggerSyncDownEvents } =
  createServiceInterval({
    name: 'syncDownEvents',
    worker: run,
    interval: SYNC_EVENTS_INTERVAL,
  })
