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

  createInterval({ name, worker, interval }: ServiceIntervalOptions): {
    init: () => void
    triggerNow: () => void
  } {
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
      running = false
      this.schedulerStateMap.set(name, {
        token,
        timeoutId: null,
        abortController: new AbortController(),
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

        if (this.paused) {
          scheduleNextRun(interval)
          return
        }

        running = true
        let nextInterval = interval
        try {
          // Always read signal from the map so abortAll() replacements
          // take effect on subsequent ticks.
          const signal = current.abortController.signal
          const customInterval = await Promise.resolve(worker(signal))
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
          // Defer the tick until resumed.
          this.pausedCallbacks.push(() => scheduleNextRun(interval))
          return
        }

        const timeoutId = setTimeout(runTick!, interval)
        // Update only the timeoutId, preserving the current abortController.
        current.timeoutId = timeoutId
      }

      scheduleNextRun(interval)
    }

    const triggerNow = () => {
      const current = this.schedulerStateMap.get(name)
      if (!current || !runTick || running) return
      if (current.timeoutId) {
        clearTimeout(current.timeoutId)
        current.timeoutId = null
      }
      runTick()
    }

    return { init, triggerNow }
  }

  /** Abort all in-flight workers and replace their AbortControllers
   * with fresh ones so subsequent ticks get clean signals. */
  abortAll(): void {
    this.schedulerStateMap.forEach((state) => {
      state.abortController.abort()
      state.abortController = new AbortController()
    })
  }

  async waitForIdle(): Promise<void> {
    while (this.runningPromises.size > 0) {
      await Promise.allSettled([...this.runningPromises])
    }
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

export function abortAllServiceIntervals(): void {
  defaultScheduler.abortAll()
}

export async function waitForAllServiceIntervalsIdle(): Promise<void> {
  return defaultScheduler.waitForIdle()
}

export async function shutdownAllServiceIntervals(): Promise<void> {
  return defaultScheduler.shutdown()
}
