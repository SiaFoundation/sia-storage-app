import { logger } from '@siastorage/logger'
import type { DatabaseAdapter } from '../adapters/db'

const MAX_LOGS = 100_000 // Maximum number of log entries to keep
const ROTATION_INTERVAL_MS = 60_000 // Check and rotate every minute

export { ROTATION_INTERVAL_MS as LOG_ROTATION_INTERVAL }

/**
 * Rotate logs by removing old entries when they exceed the maximum count.
 * Keeps only the most recent MAX_LOGS entries.
 */
export async function runLogRotation(db: DatabaseAdapter): Promise<void> {
  try {
    // Count total logs.
    const countResult = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM logs',
    )
    const count = countResult?.count ?? 0

    if (count <= MAX_LOGS) {
      return
    }

    // Delete oldest logs, keeping only MAX_LOGS.
    const toDelete = count - MAX_LOGS
    await db.runAsync(
      `DELETE FROM logs WHERE id IN (
        SELECT id FROM logs ORDER BY createdAt ASC, id ASC LIMIT ?
      )`,
      toDelete,
    )
    logger.debug('logRotation', 'rotated', { deleted: toDelete })
  } catch (error) {
    logger.error('logRotation', 'rotation_failed', { error: error as Error })
  }
}
