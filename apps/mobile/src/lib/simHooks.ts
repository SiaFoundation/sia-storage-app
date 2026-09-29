/**
 * Points where sim's test mode can hold the app, set only from the test mode
 * a development build enters for a sim session. Release builds read
 * `__DEV__` as false, so every check on these compiles away.
 */
export const simHooks: {
  /** While set, an import copy waits here after its bytes land and before it publishes them. */
  importCopyHold: Promise<void> | null
  /** When set, the next import copy ends as cancelled, and the flag clears. */
  cancelNextImportCopy: boolean
} = { importCopyHold: null, cancelNextImportCopy: false }
