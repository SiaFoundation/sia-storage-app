import { defineScenario } from '../../src/scenario'

/**
 * How long the daemon stays down before the app may bring it back. The File
 * Provider extension disconnects the folder once the daemon has been gone for
 * five seconds, so this outlasts that with room for the extension's checks.
 */
const AWAY_MS = 9_000

export default defineScenario({
  name: "the Mac's Finder folder comes back once the service is running again after a crash",
  description: `With the folder open in Finder, the daemon is killed while the app is paused, so it stays down for ${AWAY_MS / 1000}s before the app revives it. The extension disconnects the folder after five seconds and the system then ends the extension, so only the app can reconnect the folder. Once the revived daemon answers, the folder must come back on its own, and a file saved in it must reach the library.`,
  devices: { mac: 'desktop' },
  timeoutMs: 5 * 60_000,
  async run({ devices: { mac }, step, precondition, check, checkEqual, waitFor, note }) {
    // A Finder window on the folder keeps the extension running until it
    // disconnects, as it does for someone who has the folder open.
    await step('show the folder in Finder', async () => {
      Bun.spawnSync(['open', mac.finderPath()])
    })
    await step('the folder is connected before the crash', async () => {
      checkEqual('the folder is connected before the crash', await mac.folderDisconnected(), null)
    })
    // Read before the app resumes, so the app's revive cannot race it. An
    // extension that never disconnected would leave nothing to test.
    await precondition(
      'the extension disconnects the folder while the daemon is down',
      async () => {
        mac.pauseApp()
        try {
          await mac.killDaemon()
          await Bun.sleep(AWAY_MS)
          return (await mac.folderDisconnected()) !== null
        } finally {
          mac.resumeApp()
        }
      },
    )
    await step('the app revives the daemon', () =>
      waitFor('the daemon to answer again', () => mac.isRunning(), {
        timeoutMs: 30_000,
        intervalMs: 500,
      }),
    )
    const reconnected = await step('the folder comes back', () =>
      waitFor('the folder to reconnect', async () => (await mac.folderDisconnected()) === null, {
        timeoutMs: 30_000,
        intervalMs: 1000,
      }).then(
        () => true,
        () => false,
      ),
    )
    check('the folder reconnects once the daemon is running again', reconnected)
    const name = 'after-restart.bin'
    const arrived = await step(`save ${name} in the Finder folder`, async () => {
      await mac.finderWrite(name, crypto.getRandomValues(new Uint8Array(16 * 1024)))
      return waitFor(
        `${name} in the Mac's library`,
        async () => (await mac.library()).some((f) => f.name === name),
        { timeoutMs: 30_000, intervalMs: 1000 },
      ).then(
        () => true,
        () => false,
      )
    }).catch(() => false)
    if (!arrived) note(`Extension log:\n${mac.extensionLog(2)}\nApp log:\n${mac.appLog(40)}`)
    check('a file saved after the restart reaches the library', arrived)
  },
})
