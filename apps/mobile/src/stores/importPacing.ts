import { swrState } from '@siastorage/core/stores'
import type { ImportPacingSnapshot } from '../lib/importLabels'

// The scanner manager publishes one snapshot per tick; UI surfaces read it to
// name why paceable imports are deferring. The published cause is damped: it
// must repeat on two consecutive ticks to appear and be absent on two to
// clear, so a byte reading that straddles a threshold cannot flap the badge
// every 3 s. A switch between two non-null causes swaps immediately, since
// both already read as waiting. Byte fields and `at` pass through undamped so
// the moving numbers stay live. Ticks stop when the scanner is skipped
// (suspend, sync gate), so readers treat a snapshot older than STALE_MS as
// absent rather than trusting a cause frozen at suspend time.

export type ImportPacingState = ImportPacingSnapshot & { deferred: number }

const EMPTY: ImportPacingState = {
  at: 0,
  cause: null,
  freeBytes: null,
  pendingLocalBytes: null,
  deferred: 0,
}

export const PACING_STALE_MS = 10_000

const store = swrState<ImportPacingState>(EMPTY)

let candidate: ImportPacingSnapshot['cause'] = null
let streak = 0

export function publishImportPacing(tick: ImportPacingState): void {
  const current = store.getState().cause
  let cause = current
  if (tick.cause === current) {
    candidate = null
    streak = 0
  } else if (tick.cause !== null && current !== null) {
    cause = tick.cause
    candidate = null
    streak = 0
  } else {
    if (tick.cause === candidate) streak += 1
    else {
      candidate = tick.cause
      streak = 1
    }
    if (streak >= 2) {
      cause = candidate
      candidate = null
      streak = 0
    }
  }
  store.setState({ ...tick, cause })
}

function fresh(s: ImportPacingState, now: number): ImportPacingState | null {
  return s.at > 0 && now - s.at <= PACING_STALE_MS ? s : null
}

export function getImportPacing(now = Date.now()): ImportPacingState | null {
  return fresh(store.getState(), now)
}

export function useImportPacing(): ImportPacingState | null {
  const s = store.useValue((v) => v, 'snapshot')
  return fresh(s, Date.now())
}

export function resetImportPacing(): void {
  store.setState(EMPTY)
  candidate = null
  streak = 0
}
