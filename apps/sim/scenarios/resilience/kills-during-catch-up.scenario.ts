import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'a device killed six times as it starts and catches up, at least once partway through, ends with the same library as the device it follows',
  description:
    'The laptop is stopped while the phone adds 1500 files, renames 300 and deletes 200. With every network call slowed by 100 ms, the laptop starts and is killed six times, each as soon as it has synced more since its last start or holds every file, and at least one kill lands partway through the catch-up. It ends with the phone’s library, no empty folders, and every file on its own bytes.',
  devices: { phone: 'cli', laptop: 'cli' },
  timeoutMs: 8 * 60_000,
  async run({
    devices: { phone, laptop },
    network,
    waitFor,
    seed,
    converge,
    step,
    precondition,
    note,
    checkEqual,
    checkContent,
  }) {
    await step('stop the laptop', () => laptop.stop())
    const files = await step('phone adds 1500 files across 5 folders', async () => {
      const added = []
      for (let i = 0; i < 5; i++) {
        added.push(...(await seed('phone', { count: 300, size: 512, dir: `folder-${i}` })))
      }
      return added
    })
    await step('phone renames 300 and deletes 200', async () => {
      for (const f of files.slice(0, 300))
        await phone.call('files.renameFile', f.id, `renamed-${f.name}`)
      for (const f of files.slice(300, 500)) await phone.call('files.tombstoneFile', f.id)
    })
    let midCatchUp = 0
    await step('the phone has uploaded everything', () => converge(['phone']))
    const synced = async () => {
      const [row] = await laptop.sql<{ n: number }>(
        `SELECT count(*) AS n FROM files WHERE kind = 'file' AND deletedAt IS NULL`,
      )
      return row.n
    }
    // Slowed so the catch-up takes long enough to be interrupted.
    await network.setConditions({ latencyMs: 100 })
    await step('start the laptop and kill it six times while it catches up', async () => {
      for (let i = 0; i < 6; i++) {
        const before = await synced()
        await laptop.start()
        // Killed as soon as this start has synced something, so while the
        // catch-up lasts a kill lands partway through it, not at startup.
        const now = await waitFor(
          'the laptop to sync more files',
          async () => {
            const n = await synced()
            return n > before || n === 1300 ? n : false
          },
          { timeoutMs: 60_000, intervalMs: 50 },
        )
        if (now < 1300) midCatchUp++
        await laptop.kill()
      }
      await laptop.start()
    })
    await network.setConditions({ latencyMs: 0 })
    note(`${midCatchUp} of the 6 kills landed with some but not all files on the laptop`)
    await precondition('at least one kill lands during the catch-up', async () => midCatchUp > 0)
    const { files: count } = await step('both converge', () =>
      converge(undefined, { timeoutMs: 5 * 60_000 }),
    )
    checkEqual('both hold the 1300 remaining files', count, 1300)
    checkEqual(
      'the laptop has no empty folders',
      await laptop.sql(
        `SELECT path FROM directories d WHERE NOT EXISTS
         (SELECT 1 FROM files f WHERE f.directoryId = d.id AND f.deletedAt IS NULL)`,
      ),
      [],
    )
    await checkContent()
  },
})
