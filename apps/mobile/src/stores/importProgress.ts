import { swrState } from '@siastorage/core/stores'

// Drives ImportProgressModal as a live view of the most recent in-progress
// import. An import source (picker, camera, share) creates an import and
// hands its importId here; the modal subscribes to that import's summary and
// dismisses itself when the import reaches `done`. This store only holds
// which import the modal is watching; per-file progress comes from the
// import tables.
//
// REVEAL_DELAY_MS: a fast 3-file picker that finalizes almost instantly
// should never flash the modal. The importId is armed but `revealed` stays
// false until the delay elapses; if the import is already done by then, the
// modal stays hidden.

export type ImportProgressState = {
  /** The import the modal is (or will be) showing, or null when idle. */
  importId: string | null
  /** Whether the reveal delay has elapsed so the modal may show. */
  revealed: boolean
}

const INITIAL: ImportProgressState = {
  importId: null,
  revealed: false,
}

export const REVEAL_DELAY_MS = 700

const state = swrState<ImportProgressState>(INITIAL)

let revealTimer: ReturnType<typeof setTimeout> | null = null

function clearRevealTimer(): void {
  if (revealTimer) {
    clearTimeout(revealTimer)
    revealTimer = null
  }
}

/**
 * Point the modal at a freshly-created import. The modal is held hidden for
 * REVEAL_DELAY_MS so quick imports don't flash; once revealed it shows the live
 * summary and dismisses itself when the import is `done`. A second import that
 * arrives mid-watch replaces the target (newest wins; the prior one is still in
 * the Imports list).
 */
export function showImportProgress(importId: string): void {
  clearRevealTimer()
  state.setState({ importId, revealed: false })
  revealTimer = setTimeout(() => {
    revealTimer = null
    const s = state.getState()
    if (s.importId === importId) {
      state.setState({ importId, revealed: true })
    }
  }, REVEAL_DELAY_MS)
}

/** Hide and reset the modal (user-dismiss or auto-dismiss on `done`). */
export function dismissImportProgress(): void {
  clearRevealTimer()
  state.setState(INITIAL)
}

/** Synchronous read used by tests; React components use useImportProgress. */
export function getImportProgress(): ImportProgressState {
  return state.getState()
}

export function useImportProgress(): ImportProgressState {
  return state.useValue((s) => s)
}
