import { CoalescingQueue } from '../lib/coalescingQueue'
import { logger } from '@siastorage/logger'

export type SuspensionAdapters = {
  scheduler: {
    pause(): void
    abort(): void
    resume(): void
  }
  uploader: {
    suspend(): Promise<void> | void
    resume(): void
    adjustBatchForSuspension(): void
  }
  hooks?: {
    onBeforeSuspend?(): void | Promise<void>
    onAfterResume?(): void
    /**
     * Fires on every `setAppState('foreground')` call, including no-ops.
     * Lets platform glue refresh stale UI state on iOS 'inactive' →
     * 'active' flickers and on foreground events that happen while a BG
     * task already resumed the manager (where onAfterResume doesn't fire).
     */
    onForegroundActive?(): void
  }
}

type State = 'active' | 'suspending' | 'suspended' | 'resuming'
type AppStateValue = 'foreground' | 'background'

export function createSuspensionManager(adapters: SuspensionAdapters) {
  const { scheduler, uploader, hooks } = adapters
  let state: State = 'active'
  let appState: AppStateValue = 'foreground'
  const runningTasks = new Set<string>()
  const queue = new CoalescingQueue()

  // Suspend is intentionally just flag flips + one optional hook. iOS
  // suspends with file handles, sockets, and SQLite mid-step preserved,
  // so closing the DB / draining queries is unnecessary. The 0xDEAD10CC
  // contract (release the BG-task assertion within iOS's 5s expiration
  // grace) is satisfied at the BG-task call site, not here.
  async function doSuspend(): Promise<void> {
    if (state !== 'active') {
      logger.debug('suspension', 'skipped', {
        reason: state === 'suspended' ? 'already_suspended' : state,
      })
      return
    }

    state = 'suspending'
    logger.info('suspension', 'starting')

    try {
      scheduler.pause()
      scheduler.abort()
      await uploader.suspend()
      await hooks?.onBeforeSuspend?.()

      state = 'suspended'
      logger.info('suspension', 'suspended')
    } catch (e) {
      logger.error('suspension', 'suspend_error', { error: e as Error })
      uploader.resume()
      scheduler.resume()
      state = 'active'
    }
  }

  async function doResume(): Promise<void> {
    if (state !== 'suspended') {
      uploader.adjustBatchForSuspension()
      return
    }

    state = 'resuming'
    logger.info('suspension', 'resuming')

    hooks?.onAfterResume?.()
    uploader.adjustBatchForSuspension()
    uploader.resume()
    scheduler.resume()

    state = 'active'
    logger.info('suspension', 'resumed')
  }

  // Re-checks preconditions at queue execution time, not at enqueue time:
  // a BG task may register between enqueue and run.
  async function maybeSuspend(trigger: string): Promise<void> {
    if (runningTasks.size > 0) {
      logger.debug('suspension', 'skipped', {
        reason: 'background_task_running',
        activeCount: runningTasks.size,
        trigger,
      })
      return
    }
    if (appState !== 'background') {
      logger.debug('suspension', 'skipped', {
        reason: 'appstate_foreground',
        trigger,
      })
      return
    }
    await doSuspend()
  }

  return {
    suspend: () => queue.enqueue(doSuspend),
    resume: () => queue.enqueue(doResume),
    isSuspended: () => state === 'suspended',

    /**
     * Record the app's current foreground/background state. Background
     * with no BG tasks running enqueues a guarded suspend; foreground
     * enqueues a resume (no-op if not suspended).
     */
    setAppState(next: AppStateValue): Promise<void> {
      const prev = appState
      // Foreground hook fires on every 'foreground' call (including
      // no-ops) so flickers and BG-task overlaps both reach platform glue.
      if (next === 'foreground') {
        hooks?.onForegroundActive?.()
      }
      if (prev === next) return Promise.resolve()
      appState = next
      const activeCount = runningTasks.size
      if (next === 'background') {
        const willSuspend = activeCount === 0
        logger.info('suspension', 'app_state', {
          appState: next,
          prev,
          activeCount,
          willSuspend,
        })
        if (willSuspend) {
          return queue.enqueue(() => maybeSuspend('app_state'))
        }
        return Promise.resolve()
      }
      logger.info('suspension', 'app_state', {
        appState: next,
        prev,
        activeCount,
        willResume: true,
      })
      return queue.enqueue(doResume)
    },

    /** Register a BG task; resumes the manager so callers can run work. */
    async registerBackgroundTask(id: string): Promise<void> {
      runningTasks.add(id)
      logger.info('suspension', 'register_task', {
        id,
        activeCount: runningTasks.size,
        state,
        appState,
      })
      await queue.enqueue(doResume)
    },

    /** Release a BG task; suspends if it was the last one and app is in background. */
    async releaseBackgroundTask(id: string): Promise<void> {
      runningTasks.delete(id)
      const activeCount = runningTasks.size
      const willSuspend = activeCount === 0 && appState === 'background'
      logger.info('suspension', 'release_task', {
        id,
        activeCount,
        state,
        appState,
        willSuspend,
      })
      if (willSuspend) {
        await queue.enqueue(() => maybeSuspend('release_task'))
      }
    },

    getRunningBackgroundTaskIds(): readonly string[] {
      return [...runningTasks]
    },
  }
}
