// Periodic PRAGMA optimize + WAL checkpoint to keep query plans fresh
// and the WAL file trimmed.
//
// Suspension signal policy: accepts AbortSignal. Touches the DB but
// completes in <10ms in the typical case, so the signal check is
// cheap insurance against starting a checkpoint after the gate has
// closed. Pattern consistency with other scheduler-driven workers.

import { DB_OPTIMIZE_INTERVAL } from '@siastorage/core/config'
import { createServiceInterval } from '@siastorage/core/lib/serviceInterval'
import { logger } from '@siastorage/logger'
import RNFS from 'react-native-fs'
import { getWalPath } from '../db'
import { app } from '../stores/appService'

const { init: initDbOptimize } = createServiceInterval({
  name: 'dbOptimize',
  // Runs PRAGMA optimize and logs WAL size. The WAL size trendline lets us
  // verify in production that wal_autocheckpoint is keeping the WAL small;
  // checkpointing itself is delegated to SQLite's built-in auto-checkpoint.
  // Errors here are non-critical — log and move on so a transient SQLite
  // race can't propagate to an unhandled rejection.
  worker: async (signal) => {
    if (signal?.aborted) return
    try {
      await app().optimize()
      if (signal?.aborted) return
      const walStat = await RNFS.stat(getWalPath()).catch(() => null)
      logger.info('db', 'health', {
        walBytes: walStat ? Number(walStat.size) : null,
      })
    } catch (e) {
      logger.warn('db', 'optimize_failed', { error: e as Error })
    }
  },
  interval: DB_OPTIMIZE_INTERVAL,
})

export { initDbOptimize }
