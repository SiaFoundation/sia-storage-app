import { getCpuUsage, getMemoryUsage } from 'react-native-performance-toolkit'
import { PERF_MONITOR_INTERVAL } from '../config'
import { logger } from '../lib/logger'
import { createServiceInterval } from '../lib/serviceInterval'

export const initPerfMonitor = createServiceInterval({
  name: 'perfMonitor',
  worker: () => {
    const cpu = getCpuUsage()
    const mem = getMemoryUsage()
    logger.info('perfMonitor', `cpu=${cpu}% mem=${mem}MB`)
  },
  getState: async () => true,
  interval: PERF_MONITOR_INTERVAL,
})
