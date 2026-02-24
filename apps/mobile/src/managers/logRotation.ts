import { logger } from '@siastorage/logger'
import { db } from '../db'
import { createServiceInterval } from '../lib/serviceInterval'

const MAX_LOGS = 100_000 // Maximum number of log entries to keep
const ROTATION_INTERVAL_MS = 60_000 // Check and rotate every minute

/**
 * Rotate logs by removing old entries when they exceed the maximum count.
 * Keeps only the most recent MAX_LOGS entries.
 */
export async function runLogRotation(): Promise<void> {
  try {
    if (!db()) {
      return
    }
    // Count total logs.
    const countResult = await db().getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM logs',
    )
    const count = countResult?.count ?? 0

    if (count <= MAX_LOGS) {
      return
    }

    // Delete oldest logs, keeping only MAX_LOGS.
    const toDelete = count - MAX_LOGS
    await db().runAsync(
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

// Start log rotation interval and run initial rotation.
export async function initLogRotation(): Promise<void> {
  // Run initial rotation immediately.
  await runLogRotation()
  // Then start the interval.
  initLogRotationInterval()
}

const { init: initLogRotationInterval } = createServiceInterval({
  name: 'logRotation',
  worker: async () => {
    await runLogRotation()
  },
  getState: async () => true, // Always enabled.
  interval: ROTATION_INTERVAL_MS,
})
