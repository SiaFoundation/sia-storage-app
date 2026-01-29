import { logger } from './logger'

// Scheduler state for a service: the latest token and its timeout handle.
type SchedulerState = {
  token: number
  timeoutId: NodeJS.Timeout | null
}

const schedulerStateMap = new Map<string, SchedulerState>()

// Pause/resume state for testing
let paused = false
const pausedCallbacks: Array<() => void> = []

/**
 * Pauses all service intervals. Scheduled ticks will be deferred until resume.
 * Used by the test harness for pause/resume functionality.
 */
export function pauseAllServiceIntervals(): void {
  paused = true
  logger.debug('serviceInterval', 'all services paused')
}

/**
 * Resumes all service intervals. Any deferred ticks will be executed.
 */
export function resumeAllServiceIntervals(): void {
  paused = false
  logger.debug('serviceInterval', 'all services resumed')
  const callbacks = [...pausedCallbacks]
  pausedCallbacks.length = 0
  for (const cb of callbacks) {
    cb()
  }
}

/**
 * Checks if service intervals are currently paused.
 */
export function areServiceIntervalsPaused(): boolean {
  return paused
}

export function createServiceInterval({
  name,
  worker,
  getState,
  interval,
}: {
  name: string
  worker: () => void | undefined | number | Promise<void | undefined | number>
  getState: () => Promise<boolean>
  interval: number
}): () => void {
  const init = () => {
    const existing = schedulerStateMap.get(name)
    if (existing?.timeoutId) {
      clearTimeout(existing.timeoutId)
    }

    logger.debug(name, 'initializing')

    // Increment the token to invalidate any previously scheduled or in-flight ticks.
    const token = (existing?.token ?? 0) + 1
    schedulerStateMap.set(name, { token, timeoutId: null })

    async function runTick() {
      // Guard against stale ticks created before the latest init.
      const current = schedulerStateMap.get(name)
      if (!current || current.token !== token) return

      const enabled = await getState()

      // Re-check after awaiting, in case another init occurred while waiting.
      const stillCurrent = schedulerStateMap.get(name)
      if (!stillCurrent || stillCurrent.token !== token) return

      if (!enabled) {
        // Service disabled: skip work but still schedule the next check.
        scheduleNextRun(interval)
        return
      }

      let nextInterval = interval
      try {
        const customInterval = await Promise.resolve(worker())
        if (typeof customInterval === 'number') {
          nextInterval = customInterval
        }
      } finally {
        scheduleNextRun(nextInterval)
      }
    }

    function scheduleNextRun(interval: number) {
      // Only schedule if this init remains the latest.
      const current = schedulerStateMap.get(name)
      if (!current || current.token !== token) return

      if (paused) {
        // Defer the tick until resumed
        pausedCallbacks.push(() => scheduleNextRun(interval))
        return
      }

      const timeoutId = setTimeout(runTick, interval)
      schedulerStateMap.set(name, { token, timeoutId })
    }

    scheduleNextRun(interval)
  }

  return init
}

export function shutdownAllServiceIntervals() {
  schedulerStateMap.forEach((state) => {
    if (state.timeoutId) {
      clearTimeout(state.timeoutId)
    }
  })
  schedulerStateMap.clear()
}
