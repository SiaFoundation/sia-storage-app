import { DB_OPTIMIZE_INTERVAL } from '@siastorage/core/config'
import { createServiceInterval } from '@siastorage/core/lib/serviceInterval'
import { app } from '../stores/appService'

const { init: initDbOptimize } = createServiceInterval({
  name: 'dbOptimize',
  worker: () => app().optimize(),
  interval: DB_OPTIMIZE_INTERVAL,
})

export { initDbOptimize }
