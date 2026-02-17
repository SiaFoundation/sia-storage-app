import { logger } from './logger'

// Scheduler state for a service: the latest token, its timeout handle, and abort controller.
type SchedulerState = {
  token: number
  timeoutId: NodeJS.Timeout | null
  abortController: AbortController
}

const schedulerStateMap = new Map<string, SchedulerState>()
const runningPromises = new Set<Promise<void>>()

// Pause/resume state for testing
let paused = false
const pausedCallbacks: Array<() => void> = []

/**
 * Pauses all service intervals. Scheduled ticks will be deferred until resume.
 * Used by the test harness for pause/resume functionality.
 */
export function pauseAllServiceIntervals(): void {
  paused = true
  logger.debug('serviceInterval', 'all_paused')
}

/**
 * Resumes all service intervals. Any deferred ticks will be executed.
 */
export function resumeAllServiceIntervals(): void {
  paused = false
  logger.debug('serviceInterval', 'all_resumed')
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
  worker: (
    signal: AbortSignal,
  ) => void | undefined | number | Promise<void | undefined | number>
  getState: () => Promise<boolean>
  interval: number
}): { init: () => void; triggerNow: () => void } {
  let running = false
  let runTick: (() => void) | null = null

  const init = () => {
    const existing = schedulerStateMap.get(name)
    if (existing?.timeoutId) {
      clearTimeout(existing.timeoutId)
    }
    existing?.abortController.abort()

    logger.debug(name, 'initializing')

    // Increment the token to invalidate any previously scheduled or in-flight ticks.
    const token = (existing?.token ?? 0) + 1
    const abortController = new AbortController()
    running = false
    schedulerStateMap.set(name, { token, timeoutId: null, abortController })

    runTick = () => {
      const p = runTickAsync()
      runningPromises.add(p)
      p.finally(() => runningPromises.delete(p))
    }

    async function runTickAsync() {
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

      running = true
      let nextInterval = interval
      try {
        const customInterval = await Promise.resolve(
          worker(abortController.signal),
        )
        if (typeof customInterval === 'number') {
          nextInterval = customInterval
        }
      } finally {
        running = false
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

      const timeoutId = setTimeout(runTick!, interval)
      schedulerStateMap.set(name, { token, timeoutId, abortController })
    }

    scheduleNextRun(interval)
  }

  const triggerNow = () => {
    const current = schedulerStateMap.get(name)
    if (!current || !runTick || running) return
    if (current.timeoutId) {
      clearTimeout(current.timeoutId)
      schedulerStateMap.set(name, { ...current, timeoutId: null })
    }
    runTick()
  }

  return { init, triggerNow }
}

export async function shutdownAllServiceIntervals() {
  schedulerStateMap.forEach((state) => {
    if (state.timeoutId) {
      clearTimeout(state.timeoutId)
    }
    state.abortController.abort()
  })
  schedulerStateMap.clear()
  await Promise.allSettled(runningPromises)
  runningPromises.clear()
}
