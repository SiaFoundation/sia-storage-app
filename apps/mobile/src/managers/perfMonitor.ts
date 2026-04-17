// Periodic sampler for CPU, memory, and FPS counters into the log.
//
// Suspension signal policy: accepts AbortSignal. Doesn't touch the DB
// directly, just reads native counters and logs. The signal check
// avoids logging a useless tick during the suspension drain window.

import { PERF_MONITOR_INTERVAL } from '@siastorage/core/config'
import { createServiceInterval } from '@siastorage/core/lib/serviceInterval'
import { logger } from '@siastorage/logger'
import { getCpuUsage, getJsFps, getMemoryUsage, getUiFps } from 'react-native-performance-toolkit'

function run(signal?: AbortSignal): void {
  if (signal?.aborted) return
  const cpu = getCpuUsage()
  const mem = getMemoryUsage()
  const jsFps = getJsFps()
  const uiFps = getUiFps()
  logger.info('perfMonitor', 'tick', { cpu, mem, jsFps, uiFps })
}

export const { init: initPerfMonitor } = createServiceInterval({
  name: 'perfMonitor',
  worker: run,
  interval: PERF_MONITOR_INTERVAL,
})
