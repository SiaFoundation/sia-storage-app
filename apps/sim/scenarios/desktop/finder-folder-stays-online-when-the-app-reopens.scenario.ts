import { defineScenario } from '../../src/scenario'

/**
 * How long the app stays quit before each reopen. The extension takes the
 * folder offline 5s after it lost the old daemon, retrying the socket once a
 * second until then. The pauses spread the new daemon's start across the end
 * of those 5s, so on some rounds it is listening after the extension's last
 * retry and before it decides.
 */
const PAUSES_MS = [2600, 2900, 3200, 3500, 3800]

export default defineScenario({
  name: "the Mac's Finder folder stays online each time the app is quit and opened again",
  description: `With the folder open in Finder, the app is quit, which stops its daemon, and opened again, ${PAUSES_MS.length} times with a different pause each time. After each reopen a file saved in the Finder folder reaches the library. The File Provider extension takes the folder offline once the daemon has been gone for five seconds, so an extension that misses a daemon which came back just inside that time leaves the folder offline and the file never reaches the daemon.`,
  devices: { mac: 'desktop' },
  timeoutMs: 12 * 60_000,
  async run({ devices: { mac }, step, checkEqual, waitFor, note }) {
    const saved: string[] = []
    const reached: string[] = []
    for (const [i, pause] of PAUSES_MS.entries()) {
      const round = i + 1
      // A Finder window on the folder keeps the extension running through the
      // quit, as it does for someone who has the folder open. Without one the
      // system ends the extension when the app hides the folder on quit, and
      // no extension is left to time the outage.
      await step(`show the folder in Finder, reopen ${round}`, async () => {
        Bun.spawnSync(['open', mac.finderPath()])
      })
      await step(`quit the app, reopen ${round}`, () => mac.stop())
      await step(`stay quit for ${pause}ms`, () => Bun.sleep(pause))
      await step(`open it again, reopen ${round}`, () => mac.start())
      // A save made before the extension decides would land before the folder
      // is taken offline.
      await step('wait out the extension’s five seconds', () => Bun.sleep(8_000))
      const name = `after-reopen-${round}.bin`
      saved.push(name)
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
      if (arrived) reached.push(name)
      else note(`${name} did not reach the library. Extension log:\n${mac.extensionLog(1)}`)
    }
    checkEqual('every file saved after a reopen reaches the library', reached, saved)
  },
})
