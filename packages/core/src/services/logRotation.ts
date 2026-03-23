import { logger } from '@siastorage/logger'
import type { AppService } from '../app/service'

const MAX_LOGS = 100_000 // Maximum number of log entries to keep
const ROTATION_INTERVAL_MS = 60_000 // Check and rotate every minute

export { ROTATION_INTERVAL_MS as LOG_ROTATION_INTERVAL }

/**
 * Rotate logs by removing old entries when they exceed the maximum count.
 * Keeps only the most recent MAX_LOGS entries.
 */
export async function runLogRotation(app: AppService): Promise<void> {
  try {
    const count = await app.logs.count()
    if (count <= MAX_LOGS) {
      logger.debug('logRotation', 'skipped', { reason: 'under_limit', count })
      return
    }
    const deleted = await app.logs.rotate(MAX_LOGS)
    logger.debug('logRotation', 'rotated', { deleted })
  } catch (error) {
    logger.error('logRotation', 'rotation_failed', { error: error as Error })
  }
}
