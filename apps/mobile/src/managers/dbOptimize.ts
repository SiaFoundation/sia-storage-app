// Periodic PRAGMA optimize + WAL checkpoint to keep query plans fresh
// and the WAL file trimmed.
//
// Suspension signal policy: accepts AbortSignal. Touches the DB but
// completes in <10ms in the typical case, so the signal check is
// cheap insurance against starting a checkpoint after the gate has
// closed. Pattern consistency with other scheduler-driven workers.

import { DB_OPTIMIZE_INTERVAL } from '@siastorage/core/config'
import { createServiceInterval } from '@siastorage/core/lib/serviceInterval'
import { app } from '../stores/appService'

const { init: initDbOptimize } = createServiceInterval({
  name: 'dbOptimize',
  worker: async (signal) => {
    if (signal?.aborted) return
    await app().optimize()
  },
  interval: DB_OPTIMIZE_INTERVAL,
})

export { initDbOptimize }
