import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: "the Mac's trash lists trashed files, puts one back, deletes one and empties the rest",
  description:
    "The laptop adds three files and trashes them. The Mac's status window counts three in the trash, and its trash view lists them. Restore puts one back on both devices, Delete takes two clicks and deletes another for good on both, and Empty Trash takes two clicks and deletes the last on both.",
  devices: { mac: 'desktop', laptop: 'cli' },
  timeoutMs: 10 * 60_000,
  async run({ devices: { mac, laptop }, seed, converge, step, checkEqual, waitFor, capture }) {
    const window = mac.ui().window('main')
    const [kept, gone, emptied] = await step('the laptop adds three files', () =>
      seed('laptop', { count: 3, size: 16 * 1024, prefix: 'trashed' }),
    )
    await step('both converge', () => converge())
    await step('the laptop trashes all three', async () => {
      for (const file of [kept, gone, emptied]) await laptop.cli('rm', file.name)
    })
    const trashed = (device: typeof mac | typeof laptop, name: string) =>
      device
        .sql<{ trashed: number; deleted: number }>(
          `SELECT trashedAt IS NOT NULL AS trashed, deletedAt IS NOT NULL AS deleted
             FROM files WHERE name = ?1 AND kind = 'file'`,
          name,
        )
        .then((rows) => rows[0] ?? null)
    await step('the Mac takes all three trashes', () =>
      waitFor('the Mac to have all three in the trash', async () => {
        for (const file of [kept, gone, emptied]) {
          if (!(await trashed(mac, file.name))?.trashed) return undefined
        }
        return true
      }),
    )

    await step('open the window', async () => {
      await mac.openWindow()
      await window.waitFor({ id: 'trash' }, 30_000)
    })
    await waitFor('the window to count three in the trash', async () =>
      (await window.read({ id: 'trash' })) === '3' ? true : undefined,
    )
    await step('open the trash', async () => {
      await window.tap({ text: 'Trash' })
      await window.waitFor({ text: kept.name }, 30_000)
      await window.waitFor({ text: gone.name })
      await window.waitFor({ text: emptied.name })
    })
    await capture('trash-view', ['mac'])

    await step(`restore ${kept.name}`, () => window.tap({ label: `Restore ${kept.name}` }))
    await step(`delete ${gone.name}, which takes a second click`, async () => {
      await window.tap({ label: `Delete ${gone.name}` })
      await window.tap({ label: `Delete ${gone.name} for good` })
    })

    const settled = (device: typeof mac | typeof laptop) =>
      waitFor(`${device.name} to have one back and one deleted`, async () => {
        const back = await trashed(device, kept.name)
        const deleted = await trashed(device, gone.name)
        return back && !back.trashed && deleted?.deleted ? true : undefined
      })
        .then(() => 'one back, one deleted')
        .catch(() => 'not settled')
    checkEqual(
      'the Mac has one file back and one deleted for good',
      await settled(mac),
      'one back, one deleted',
    )
    checkEqual('the laptop has the same', await settled(laptop), 'one back, one deleted')

    await step('empty the trash, which takes a second click', async () => {
      await window.tap({ text: 'Empty Trash' })
      await window.tap({ text: 'Delete 1 item for good' })
    })
    const emptiedOn = (device: typeof mac | typeof laptop) =>
      waitFor(`${device.name} to have the last file deleted`, async () =>
        (await trashed(device, emptied.name))?.deleted ? true : undefined,
      )
        .then(() => 'deleted')
        .catch(() => 'not deleted')
    checkEqual('Empty Trash deletes the last file on the Mac', await emptiedOn(mac), 'deleted')
    checkEqual('and on the laptop', await emptiedOn(laptop), 'deleted')
  },
})
