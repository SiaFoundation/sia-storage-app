import { CoalescingQueue } from '../lib/coalescingQueue'
import { raceWithTimeout } from '../lib/timeout'
import { logger } from '@siastorage/logger'

export type SuspensionAdapters = {
  scheduler: {
    pause(): void
    abort(): void
    resume(): void
    waitForIdle(): Promise<void>
  }
  uploader: {
    suspend(): Promise<void>
    resume(): void
    adjustBatchForSuspension(): void
    getDiagnostics(): {
      isSuspended: boolean
      batchId: string | null
      filesInBatch: number
      hasPacker: boolean
      finalizing: boolean
    }
  }
  db: {
    gate(): void
    ungate(): void
    waitForIdle(): Promise<void>
    close(): Promise<void>
    reopen(): Promise<void>
  }
  hooks?: {
    onBeforeSuspend?(): void | Promise<void>
    onAfterResume?(): void
  }
  hardDeadlineMs: number
}

type State = 'active' | 'suspending' | 'suspended' | 'resuming'
type AppStateValue = 'foreground' | 'background'

export function createSuspensionManager(adapters: SuspensionAdapters) {
  const { scheduler, uploader, db, hooks, hardDeadlineMs } = adapters
  let state: State = 'active'
  let appState: AppStateValue = 'foreground'
  const runningTasks = new Set<string>()
  const queue = new CoalescingQueue()

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
      // Phase 0: Platform-specific pre-work (e.g. flush logs, disable SWR).
      await hooks?.onBeforeSuspend?.()

      // Phase 1: Signal services to stop. pause() prevents new scheduler
      // ticks, abort() tells in-flight workers to exit at their next
      // signal.aborted check, upload manager parks its async loop.
      scheduler.pause()
      scheduler.abort()
      await uploader.suspend()
      logger.debug('suspension', 'services_paused')

      // Phase 2: Drain services with a hard deadline. DB is still open so
      // workers can complete their current unit of work (DB writes, cursor
      // updates) without hitting DatabaseSuspendedError.
      const drainStart = Date.now()
      const drained = await raceWithTimeout(scheduler.waitForIdle(), hardDeadlineMs)

      if (drained.ok) {
        logger.debug('suspension', 'services_drained', {
          drainMs: Date.now() - drainStart,
        })
      } else {
        logger.warn('suspension', 'hard_deadline_reached', {
          drainMs: Date.now() - drainStart,
        })
      }

      // Phase 3: Gate the DB so straggler queries throw
      // DatabaseSuspendedError instead of reaching the native queue.
      db.gate()
      logger.debug('suspension', 'db_gated')

      // Phase 4: Drain queries already dispatched to the native queue.
      // Use remaining budget from the hard deadline so a stuck query
      // can't block suspension indefinitely.
      const dbDrainStart = Date.now()
      const elapsedMs = dbDrainStart - drainStart
      const remainingMs = Math.max(hardDeadlineMs - elapsedMs, 1000)
      const dbDrainResult = await raceWithTimeout(db.waitForIdle(), remainingMs)
      const dbDrainMs = Date.now() - dbDrainStart
      if (dbDrainResult.ok) {
        logger.debug('suspension', 'db_drained', { dbDrainMs })
      } else {
        logger.warn('suspension', 'db_drain_timeout', {
          dbDrainMs,
          remainingMs,
        })
      }

      // Phase 5: Checkpoint WAL to release file locks, then close. Race
      // against the remaining deadline — if native close hangs on fsync,
      // the OS kill is coming regardless, so we don't wait forever in JS.
      const dbCloseStart = Date.now()
      const closeBudget = Math.max(hardDeadlineMs - (dbCloseStart - drainStart), 1000)
      const closed = await raceWithTimeout(db.close(), closeBudget)
      const dbCloseMs = Date.now() - dbCloseStart
      if (closed.ok) {
        logger.debug('suspension', 'db_closed', { dbCloseMs })
      } else {
        logger.warn('suspension', 'db_close_timeout', { dbCloseMs, closeBudget })
      }
      state = 'suspended'
    } catch (e) {
      // Unlikely — each phase handles its own errors internally.
      // Try to undo partial suspension so the app remains usable.
      logger.error('suspension', 'suspend_error', { error: e as Error })
      hooks?.onAfterResume?.()
      db.ungate()
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

    try {
      await db.reopen()
    } catch (e) {
      logger.error('suspension', 'resume_error', { error: e as Error })
      state = 'suspended'
      return
    }

    // Ungate after reopen so queries can't reach a closed handle.
    // reopen() uses the raw database connection (not the gated adapter),
    // so the gate being active during reopen is harmless.
    db.ungate()
    hooks?.onAfterResume?.()
    logger.debug('suspension', 'db_reopened')

    uploader.adjustBatchForSuspension()
    uploader.resume()
    scheduler.resume()
    state = 'active'
    logger.info('suspension', 'resumed')
  }

  // Guarded wrapper: re-checks preconditions at the moment the queue runs
  // it, not at enqueue time. Between enqueue and execution, another
  // registerBackgroundTask could have added a task that should now block
  // the suspend.
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
    // Direct triggers — kept for manual control (e.g. tests that want to
    // force a suspend without touching appState).
    suspend: () => queue.enqueue(doSuspend),
    resume: () => queue.enqueue(doResume),
    isSuspended: () => state === 'suspended',

    /**
     * Record the app's current foreground/background state. When
     * transitioning to background with no BG tasks running, enqueues a
     * guarded suspend. When transitioning to foreground, enqueues a
     * resume (no-op if not suspended). Returns a Promise that resolves
     * when any enqueued work settles — callers that need to grant iOS
     * extra execution time (via BackgroundTimer.start) should await it.
     */
    setAppState(next: AppStateValue): Promise<void> {
      const prev = appState
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

    /**
     * Register a BG task as running. Ensures the DB is open before
     * returning so callers can safely query.
     */
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

    /**
     * Release a BG task. If this was the last running task AND the app
     * is in background, await a guarded suspend. Otherwise return
     * immediately.
     */
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
