import { PERF_MONITOR_INTERVAL } from '@siastorage/core/config'
import { logger } from '@siastorage/logger'
import { getCpuUsage, getMemoryUsage } from 'react-native-performance-toolkit'
import { createServiceInterval } from '../lib/serviceInterval'

export const { init: initPerfMonitor } = createServiceInterval({
  name: 'perfMonitor',
  worker: () => {
    const cpu = getCpuUsage()
    const mem = getMemoryUsage()
    logger.info('perfMonitor', 'tick', { cpu, mem })
  },
  getState: async () => true,
  interval: PERF_MONITOR_INTERVAL,
})
