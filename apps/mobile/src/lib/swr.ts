// Global SWR enabled flag. SWR's isPaused callback polls this on each
// revalidation attempt; flipping the flag is synchronous and takes
// effect immediately. Mirrors AppState: enabled when foregrounded,
// disabled otherwise — the suspension manager flips it on AppState
// transitions.
//
// Initialized from AppState so a cold-start BG-task launch doesn't fire
// SWR fetchers from the initial React mount before the suspension
// manager has wired up its handlers.

import { AppState } from 'react-native'

let enabled = AppState.currentState === 'active'

export function setSWREnabled(value: boolean): void {
  enabled = value
}

export function isSWREnabled(): boolean {
  return enabled
}
