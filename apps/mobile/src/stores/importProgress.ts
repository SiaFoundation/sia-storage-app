import { swrState } from '@siastorage/core/stores'

// Drives ImportProgressModal during picker / camera / share-intent
// imports. The archive walk has its own ArchiveSyncModal and does not
// flow through this store.
//
// idle      — no import in flight.
// pending   — copy started, modal suppressed for REVEAL_DELAY_MS so
//             quick imports don't flash a modal.
// running   — modal visible with progress.
// complete  — held for SUCCESS_FLASH_MS so the user sees the check,
//             then auto-transitions to idle.
// error     — sticks until the user dismisses.
//
// Concurrent imports (e.g. share-intent firing while a picker import
// is mid-copy) fold into the same modal: totals accumulate and
// completion waits until every in-flight import has finished.

export type ImportProgressPhase = 'idle' | 'pending' | 'running' | 'complete' | 'error'

export type ImportProgressState = {
  phase: ImportProgressPhase
  totalFiles: number
  copiedFiles: number
  totalBytes: number
  copiedBytes: number
  errorMessage: string | null
}

const INITIAL: ImportProgressState = {
  phase: 'idle',
  totalFiles: 0,
  copiedFiles: 0,
  totalBytes: 0,
  copiedBytes: 0,
  errorMessage: null,
}

export const REVEAL_DELAY_MS = 700
export const SUCCESS_FLASH_MS = 700

const state = swrState<ImportProgressState>(INITIAL)

let dismissTimer: ReturnType<typeof setTimeout> | null = null
let inFlight = 0

function setState(partial: Partial<ImportProgressState>): void {
  state.setState({ ...state.getState(), ...partial })
}

function clearDismissTimer(): void {
  if (dismissTimer) {
    clearTimeout(dismissTimer)
    dismissTimer = null
  }
}

/** Begin a new import. Concurrent begins fold their totals into the
 * existing modal instead of resetting it. */
export function beginImportProgress(totalFiles: number, totalBytes: number): void {
  inFlight += 1
  const s = state.getState()
  if (s.phase === 'pending' || s.phase === 'running') {
    setState({
      totalFiles: s.totalFiles + totalFiles,
      totalBytes: s.totalBytes + totalBytes,
    })
    return
  }
  clearDismissTimer()
  state.setState({
    ...INITIAL,
    phase: 'pending',
    totalFiles,
    totalBytes,
  })
}

export function revealImportProgress(): void {
  if (state.getState().phase !== 'pending') return
  setState({ phase: 'running' })
}

export function reportImportProgress(bytes: number): void {
  const s = state.getState()
  if (s.phase === 'idle' || s.phase === 'complete' || s.phase === 'error') return
  setState({
    copiedFiles: s.copiedFiles + 1,
    copiedBytes: s.copiedBytes + bytes,
  })
}

/** One import finished its copies. If others are still in flight, hold;
 * otherwise transition to 'complete' for SUCCESS_FLASH_MS then dismiss. */
export function finishImportProgress(): void {
  inFlight = Math.max(0, inFlight - 1)
  if (inFlight > 0) return
  const s = state.getState()
  if (s.phase !== 'pending' && s.phase !== 'running') return
  if (s.phase === 'pending') {
    state.setState(INITIAL)
    return
  }
  setState({ phase: 'complete' })
  clearDismissTimer()
  dismissTimer = setTimeout(() => {
    dismissTimer = null
    state.setState(INITIAL)
  }, SUCCESS_FLASH_MS)
}

/** Any in-flight imports collapse into this error — sibling finishes
 * after this point are no-ops. */
export function failImportProgress(message: string): void {
  inFlight = 0
  clearDismissTimer()
  setState({ phase: 'error', errorMessage: message })
}

export function dismissImportProgress(): void {
  inFlight = 0
  clearDismissTimer()
  state.setState(INITIAL)
}

/** Synchronous read used by tests; React components use useImportProgress. */
export function getImportProgress(): ImportProgressState {
  return state.getState()
}

export function useImportProgress(): ImportProgressState {
  return state.useValue((s) => s)
}
