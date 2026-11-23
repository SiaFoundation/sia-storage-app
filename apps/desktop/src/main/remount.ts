/**
 * Registers the Finder folder again each time the daemon comes back.
 *
 * The File Provider extension disconnects the folder once the daemon has been
 * gone for five seconds, and the system then ends the extension, so nothing on
 * its side is left to reconnect it when the daemon returns. A register clears
 * that disconnect, the same one launch makes.
 *
 * Each call gets a register of its own, run after any still in progress. A
 * register spends seconds confirming that the system kept the folder, and a
 * daemon that drops again in that time can be disconnected after the register
 * ran, so joining the running one would leave that second disconnect in place.
 *
 * `start` reports its own failures. One that throws anyway does not stop the
 * registers queued after it.
 */
export function createRemount(
  start: () => Promise<void>,
  quitting: () => boolean,
): () => Promise<void> {
  let queue: Promise<void> = Promise.resolve()
  return () => {
    queue = queue
      .then(async () => {
        // Checked when its turn comes, not when queued: a quit that began in
        // between hides the folder, and a register would show it again.
        if (!quitting()) await start()
      })
      .catch(() => {})
    return queue
  }
}
