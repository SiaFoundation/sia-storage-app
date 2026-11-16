import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: "opening a file from the Mac's Finder folder in an app counts as using it",
  description:
    "A file saved in Finder is recorded by the Mac's daemon as held by Finder, with a last-use time. Opening the file in TextEdit makes the system report a new last-used date to the extension, and the daemon moves that last use forward, so its eviction pass ranks the file as just used.",
  devices: { mac: 'desktop' },
  async run({ devices, step, waitFor, check }) {
    const { mac } = devices
    await step('a file is saved in Finder', () =>
      mac.finderWrite('opened.txt', new TextEncoder().encode('opened in an app')),
    )
    const usedAt = async () =>
      (
        await mac.sql<{ usedAt: number }>(
          "SELECT m.usedAt AS usedAt FROM files f JOIN mount_copies m ON m.fileId = f.id WHERE f.name = 'opened.txt'",
        )
      )[0]?.usedAt
    const before = await waitFor('the Mac to record the file as held by Finder', usedAt, {
      timeoutMs: 60_000,
      intervalMs: 500,
    })

    // A new TextEdit process of its own, so the one stopped at the end is
    // never one holding someone's documents.
    const textEdits = () =>
      new Set(
        Bun.spawnSync(['pgrep', '-x', 'TextEdit']).stdout.toString().split(/\s+/).filter(Boolean),
      )
    const running = textEdits()
    await step('the file opens in TextEdit', async () => {
      Bun.spawnSync(['open', '-n', '-g', '-a', 'TextEdit', mac.finderPath('opened.txt')])
    })
    try {
      const after = await waitFor(
        "the file's last use to move forward",
        async () => {
          const at = await usedAt()
          return at !== undefined && at > before ? at : undefined
        },
        { timeoutMs: 30_000, intervalMs: 500 },
      )
      check('opening the file moved its last use forward', after > before, `${before} to ${after}`)
    } finally {
      for (const pid of textEdits()) if (!running.has(pid)) process.kill(Number(pid))
    }
  },
})
