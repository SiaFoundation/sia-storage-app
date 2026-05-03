import { CoalescingQueue } from '../lib/coalescingQueue'
import { raceWithTimeout } from '../lib/timeout'
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
  db: {
    /** Block new adapter queries from reaching native. Sync. */
    gate(): void
    /** Re-allow queries and drain any parked waiters. */
    ungate(): void
    /** Resolves when all in-flight native queries have settled. */
    waitForIdle(): Promise<void>
    /**
     * Cancel the currently executing statement on the active connection
     * (sqlite3_interrupt). Sync, thread-safe; the in-flight query rejects
     * with SQLITE_INTERRUPT. Looped during suspend until waitForIdle
     * resolves so the SQLite mutex / WAL lock is released before iOS
     * freezes the process (= 0xDEAD10CC trigger).
     */
    interrupt(): void
    /** Diagnostics-only: current trackStart - trackEnd delta. Lets the
     * drain loop log whether interrupts are actually advancing inflight. */
    getInflightCount(): number
  }
  platform: {
    /**
     * Remaining iOS background execution time in milliseconds — wraps
     * UIApplication.backgroundTimeRemaining. Reflects iOS's actual
     * deadline for the current path (BGTask wake window, app-suspend
     * grace, beginBackgroundTask grant), so the drain loop can cap
     * itself before iOS SIGKILLs us.
     * https://developer.apple.com/documentation/uikit/uiapplication/backgroundtimeremaining
     *
     * Non-iOS / no-op test: return Number.POSITIVE_INFINITY.
     */
    getBackgroundTimeRemainingMs(): number
  }
  hooks?: {
    /**
     * Fired (fire-and-forget) once the manager has marked itself
     * suspended. Use for battery-hygiene work (stop forwarders, cancel
     * scanners) that isn't load-bearing for the freeze-safe transition;
     * awaiting it would push the BG-task release toward iOS's expiration
     * deadline.
     */
    onAfterSuspend?(): void | Promise<void>
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

// Reserve we hold back from iOS's remaining background time so the
// caller's release / BackgroundFetch.finish lands inside the budget.
// 200ms covers a JS->native hop plus iOS's own bookkeeping; calibrated
// against TestFlight crash latencies. Lower = more drain time, higher
// kill risk; higher = more safety, less drain time.
const FINISH_RESERVE_MS = 200

// Per-iteration wait inside the interrupt loop. Short enough that a
// drained connection breaks out almost immediately; long enough that we
// don't burn CPU re-issuing sqlite3_interrupt in a tight loop. Each
// iteration: race(waitForIdle, INTERRUPT_TICK_MS) → if pending,
// interrupt + loop.
const INTERRUPT_TICK_MS = 50

// Hard ceiling on total drain time, independent of iOS's reported
// budget. Backstops two scenarios where the dynamic budget alone fails:
//   (a) UIApplication.backgroundTimeRemaining returns DBL_MAX (logged
//       as "null" via JSON.stringify) when iOS isn't actually moving us
//       toward suspension — e.g. foreground re-arrives mid-drain — so
//       the `budget - reserve > 0` check never trips.
//   (b) The mobile DatabaseAdapter's withTransactionAsync increments
//       inflightCount BEFORE waiting for txMutex; a large backlog of
//       queued transactions can keep waitForIdle pending for minutes.
// 5s sits comfortably under iOS's 30s beginBackgroundTask grant in the
// normal app-backgrounding path and matches the 5s expiration grace in
// the BG-task path; whichever ceiling iOS actually enforces fires
// before this static one.
const MAX_DRAIN_MS = 5_000

export type CreateSuspensionManagerOptions = {
  /**
   * Initial AppState. iOS BG-task wakes start the JS runtime in the
   * 'background' state — without this, the manager would think it's
   * foreground until the first AppState event, and would happily
   * suspend the moment a BG task releases its lifecycle.
   */
  initialAppState?: AppStateValue
}

export function createSuspensionManager(
  adapters: SuspensionAdapters,
  options: CreateSuspensionManagerOptions = {},
) {
  const { scheduler, uploader, db, platform, hooks } = adapters
  let state: State = 'active'
  let appState: AppStateValue = options.initialAppState ?? 'foreground'
  const runningTasks = new Set<string>()
  const queue = new CoalescingQueue()

  // Loops db.interrupt + waitForIdle until the active connection is idle
  // or iOS's remaining background time (minus FINISH_RESERVE_MS) is
  // exhausted. sqlite3_interrupt cancels the statement currently
  // executing, releasing the SQLite mutex and any held WAL file lock —
  // the mechanism behind 0xDEAD10CC. A worker iterating cursor rows may
  // dispatch a follow-up after the interrupted call returns, so the
  // loop re-checks idle each tick until quiet or out of budget.
  //
  // The dynamic budget (UIApplication.backgroundTimeRemaining) is
  // strictly better than a static cap: in the normal app-backgrounding
  // path we get ~30s of headroom; in the BG-task expirationHandler
  // path under memory pressure we get whatever iOS actually allotted
  // this invocation (sometimes less than 5s). See DTS thread 740117 —
  // there is no documented mechanism to extend past the BGTask budget,
  // so the ceiling we read here IS the deadline.
  async function drainDb(): Promise<void> {
    const drainStart = Date.now()
    const enteredFromBackground = appState === 'background'
    let attempts = 0
    while (true) {
      // If we entered drain from a background transition AND the user
      // re-foregrounded mid-drain, iOS will not freeze the process —
      // there is nothing left to protect against. Continuing to
      // interrupt while the DB is gated just keeps UI queries rejecting
      // (DatabaseSuspendedError) while the user is actively in the app.
      // Bail and let doResume ungate. Direct suspend() calls (state was
      // already 'foreground') are honored to completion since the
      // caller explicitly asked for it.
      if (enteredFromBackground && appState !== 'background') {
        logger.debug('suspension', 'drain_aborted_foreground', {
          drainMs: Date.now() - drainStart,
          attempts,
        })
        return
      }
      const elapsedMs = Date.now() - drainStart
      // Hard ceiling — see MAX_DRAIN_MS comment. iOS's dynamic budget
      // can read as Infinity (foreground state surface or pre-suspend
      // grace), and a large worker backlog can keep waitForIdle pending
      // for minutes. Bail at MAX_DRAIN_MS regardless.
      if (elapsedMs >= MAX_DRAIN_MS) {
        logger.warn('suspension', 'drain_deadline', {
          drainMs: elapsedMs,
          attempts,
          reason: 'max_drain_ms',
        })
        return
      }
      const idle = await raceWithTimeout(db.waitForIdle(), INTERRUPT_TICK_MS)
      if (idle.ok) {
        logger.debug('suspension', 'drained', {
          drainMs: Date.now() - drainStart,
          attempts,
          // Snapshot of iOS budget at completion. Confirms the native
          // module is callable; while foregrounded reads return Infinity
          // (logged as null), while backgrounded counts down.
          iosRemainingMs: platform.getBackgroundTimeRemainingMs(),
        })
        return
      }
      const iosBudgetMs = platform.getBackgroundTimeRemainingMs()
      const remainingMs = iosBudgetMs - FINISH_RESERVE_MS
      if (remainingMs <= 0) {
        logger.warn('suspension', 'drain_deadline', {
          drainMs: Date.now() - drainStart,
          attempts,
          iosBudgetMs,
          remainingMs,
          reason: 'ios_budget',
        })
        return
      }
      // Per-iteration trace: proves the budget check ran AND we
      // proceeded to interrupt. inflight before the interrupt — if it
      // doesn't decrease across consecutive ticks, the interrupt isn't
      // landing on a real statement (loop spinning futilely vs. real
      // backlog draining). Debug-level so it stays out of prod.
      logger.debug('suspension', 'interrupt_tick', {
        attempt: attempts,
        elapsedMs: Date.now() - drainStart,
        iosBudgetMs,
        inflightBefore: db.getInflightCount(),
      })
      db.interrupt()
      attempts++
    }
  }

  // Wraps the hook in an async IIFE so sync throws and rejected promises
  // both land in the same catch — a buggy hook can't unwind the suspended
  // state, and we don't push the BG-task release toward iOS's deadline.
  function fireAfterSuspendHook(): void {
    void (async () => {
      try {
        await hooks?.onAfterSuspend?.()
      } catch (error) {
        logger.error('suspension', 'after_suspend_error', { error: error as Error })
      }
    })()
  }

  function rollbackToActive(): void {
    db.ungate()
    uploader.resume()
    scheduler.resume()
    state = 'active'
  }

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
      db.gate()
      scheduler.pause()
      scheduler.abort()
      await uploader.suspend()
      await drainDb()
      state = 'suspended'
      logger.info('suspension', 'suspended')
      fireAfterSuspendHook()
    } catch (e) {
      logger.error('suspension', 'suspend_error', { error: e as Error })
      rollbackToActive()
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
    db.ungate()
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
