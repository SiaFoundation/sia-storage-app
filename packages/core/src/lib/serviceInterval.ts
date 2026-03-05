import { logger } from '@siastorage/logger'

type SchedulerState = {
  token: number
  timeoutId: ReturnType<typeof setTimeout> | null
  abortController: AbortController
}

type ServiceIntervalOptions = {
  name: string
  worker: (
    signal: AbortSignal,
  ) => void | undefined | number | Promise<void | undefined | number>
  getState: () => Promise<boolean>
  interval: number
}

export class ServiceScheduler {
  private schedulerStateMap = new Map<string, SchedulerState>()
  private runningPromises = new Set<Promise<void>>()
  private paused = false
  private pausedCallbacks: Array<() => void> = []

  pause(): void {
    this.paused = true
    logger.debug('serviceInterval', 'all_paused')
  }

  resume(): void {
    this.paused = false
    logger.debug('serviceInterval', 'all_resumed')
    const callbacks = [...this.pausedCallbacks]
    this.pausedCallbacks.length = 0
    for (const cb of callbacks) {
      cb()
    }
  }

  isPaused(): boolean {
    return this.paused
  }

  createInterval({
    name,
    worker,
    getState,
    interval,
  }: ServiceIntervalOptions): { init: () => void; triggerNow: () => void } {
    let running = false
    let runTick: (() => void) | null = null

    const init = () => {
      const existing = this.schedulerStateMap.get(name)
      if (existing?.timeoutId) {
        clearTimeout(existing.timeoutId)
      }
      existing?.abortController.abort()

      logger.debug(name, 'initializing')

      // Increment the token to invalidate any previously scheduled or in-flight ticks.
      const token = (existing?.token ?? 0) + 1
      const abortController = new AbortController()
      running = false
      this.schedulerStateMap.set(name, {
        token,
        timeoutId: null,
        abortController,
      })

      runTick = () => {
        const p = runTickAsync()
        this.runningPromises.add(p)
        p.finally(() => this.runningPromises.delete(p))
      }

      const runTickAsync = async () => {
        // Guard against stale ticks created before the latest init.
        const current = this.schedulerStateMap.get(name)
        if (!current || current.token !== token) return

        const enabled = await getState()

        // Re-check after awaiting, in case another init occurred while waiting.
        const stillCurrent = this.schedulerStateMap.get(name)
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

      const scheduleNextRun = (interval: number) => {
        // Only schedule if this init remains the latest.
        const current = this.schedulerStateMap.get(name)
        if (!current || current.token !== token) return

        if (this.paused) {
          // Defer the tick until resumed
          this.pausedCallbacks.push(() => scheduleNextRun(interval))
          return
        }

        const timeoutId = setTimeout(runTick!, interval)
        this.schedulerStateMap.set(name, { token, timeoutId, abortController })
      }

      scheduleNextRun(interval)
    }

    const triggerNow = () => {
      const current = this.schedulerStateMap.get(name)
      if (!current || !runTick || running) return
      if (current.timeoutId) {
        clearTimeout(current.timeoutId)
        this.schedulerStateMap.set(name, { ...current, timeoutId: null })
      }
      runTick()
    }

    return { init, triggerNow }
  }

  async shutdown(): Promise<void> {
    this.schedulerStateMap.forEach((state) => {
      if (state.timeoutId) {
        clearTimeout(state.timeoutId)
      }
      state.abortController.abort()
    })
    this.schedulerStateMap.clear()
    await Promise.allSettled(this.runningPromises)
    this.runningPromises.clear()
  }
}

const defaultScheduler = new ServiceScheduler()

export function pauseAllServiceIntervals(): void {
  defaultScheduler.pause()
}

export function resumeAllServiceIntervals(): void {
  defaultScheduler.resume()
}

export function areServiceIntervalsPaused(): boolean {
  return defaultScheduler.isPaused()
}

export function createServiceInterval(opts: ServiceIntervalOptions): {
  init: () => void
  triggerNow: () => void
} {
  return defaultScheduler.createInterval(opts)
}

export async function shutdownAllServiceIntervals(): Promise<void> {
  return defaultScheduler.shutdown()
}
