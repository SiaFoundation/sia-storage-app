/**
 * Module-level registry of currently-running BG tasks. Read by CPU-heavy
 * auto-ticking scanners so they can short-circuit during BGAppRefreshTask
 * wakes — Apple still enforces the 80%/60s CPU monitor on fetch tasks
 * (no requiresExternalPower opt-out for them) and a heavy scan can trip
 * cpu_resource_fatal. BGProcessingTask is exempt because
 * requiresExternalPower=true disables the monitor.
 *
 * Lives in its own file to break a cycle between backgroundTasks.ts
 * (writer + caller of scanners) and the scanners themselves (readers).
 *
 * Tracks per-task-id rather than a single "current type" so overlapping
 * tasks don't stomp each other (e.g. if a fetch and processing task
 * overlap, finishing one doesn't clear the other's active state).
 */
export type BgTaskType = 'BGAppRefreshTask' | 'BGProcessingTask' | 'BackgroundTask'

const active = new Map<string, BgTaskType>()

export function setActiveBgTask(id: string, type: BgTaskType): void {
  active.set(id, type)
}

export function clearActiveBgTask(id: string): void {
  active.delete(id)
}

export function isBgTaskActive(type: BgTaskType): boolean {
  for (const t of active.values()) {
    if (t === type) return true
  }
  return false
}
