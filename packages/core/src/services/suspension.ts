import { CoalescingQueue } from '../lib/coalescingQueue'
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

export function createSuspensionManager(adapters: SuspensionAdapters) {
  const { scheduler, uploader, db, hooks, hardDeadlineMs } = adapters
  let state: State = 'active'
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
      let deadlineTimer: ReturnType<typeof setTimeout>
      const deadlinePromise = new Promise<false>((r) => {
        deadlineTimer = setTimeout(() => r(false), hardDeadlineMs)
      })
      let drained: boolean
      try {
        drained = await Promise.race([scheduler.waitForIdle().then(() => true), deadlinePromise])
      } finally {
        clearTimeout(deadlineTimer!)
      }

      if (drained) {
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
      const elapsedMs = Date.now() - drainStart
      const remainingMs = Math.max(hardDeadlineMs - elapsedMs, 1000)
      const dbDrained = await Promise.race([
        db.waitForIdle().then(() => true),
        new Promise<false>((r) => setTimeout(() => r(false), remainingMs)),
      ])
      if (!dbDrained) {
        logger.warn('suspension', 'db_drain_timeout', {
          remainingMs,
        })
      }

      // Phase 5: Checkpoint WAL to release file locks, then close.
      await db.close()
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

  return {
    suspend: () => queue.enqueue(doSuspend),
    resume: () => queue.enqueue(doResume),
    isSuspended: () => state === 'suspended',
  }
}
