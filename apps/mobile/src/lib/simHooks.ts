/**
 * Points where sim's test mode can hold or observe the app, used only from
 * the test mode a development build enters for a sim session. Release builds
 * read `__DEV__` as false, so every check on these compiles away.
 */
export const simHooks: {
  /** While set, an import copy waits here after its bytes land and before it publishes them. */
  importCopyHold: Promise<void> | null
  /** When set, the next import copy ends as cancelled, and the flag clears. */
  cancelNextImportCopy: boolean
  /**
   * Touches the app's surfaces have seen begin. sim reads it around a tap to
   * tell a tap the app received from one lost on the way. DimSurface counts
   * from two handlers that can both see one touch, so it can count twice.
   */
  touches: number
} = { importCopyHold: null, cancelNextImportCopy: false, touches: 0 }
