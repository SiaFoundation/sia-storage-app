import { fileHash, sha256 } from '../../src/integrity'
import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: "a file saved into the Mac's Finder folder reaches a laptop with its bytes",
  description:
    "A file written into the Mac's Finder folder goes through the File Provider extension to the daemon, uploads, and reaches the laptop, whose copy has the same bytes.",
  devices: { mac: 'desktop', laptop: 'cli' },
  timeoutMs: 8 * 60_000,
  async run({ devices, converge, step, checkEqual, waitFor, checkContent }) {
    const { mac, laptop } = devices
    const bytes = crypto.getRandomValues(new Uint8Array(256 * 1024))
    await step('save report.bin into the Finder folder', () => mac.finderWrite('report.bin', bytes))
    await step('the laptop gets it', () =>
      waitFor(
        'report.bin on the laptop',
        async () => (await laptop.library()).some((f) => f.name === 'report.bin' && f.uploaded),
        { timeoutMs: 120_000, intervalMs: 1000 },
      ),
    )
    await step('both converge', () => converge())
    const entry = (await laptop.library()).find((f) => f.name === 'report.bin')
    checkEqual(
      "the laptop's copy has the saved bytes",
      entry && fileHash(entry.hash),
      sha256(bytes),
    )
    await checkContent()
  },
})
