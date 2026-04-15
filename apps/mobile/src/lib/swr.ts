// Global SWR enabled flag for background suspension.
// SWR's isPaused callback polls this on each revalidation attempt.
// Flipping the flag is synchronous and takes effect immediately.

let enabled = true

export function setSWREnabled(value: boolean): void {
  enabled = value
}

export function isSWREnabled(): boolean {
  return enabled
}
