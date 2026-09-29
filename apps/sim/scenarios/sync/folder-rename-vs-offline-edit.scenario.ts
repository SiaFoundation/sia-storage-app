import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'a peer’s offline edit to one file in a renamed folder puts that file back in the old folder on both devices',
  description:
    'The phone renames a folder of 20 files while the laptop, offline, renames one of those files. Sync keeps the newest copy of each file’s metadata as a whole, so the laptop’s later rename carries the file’s old folder with it. When the laptop reconnects both devices agree: 19 files are in the renamed folder, and the file the laptop edited is back in the old one.',
  devices: { phone: 'cli', laptop: 'cli' },
  needsReview:
    'A file’s metadata syncs as one record with its folder in it, so the offline rename, being newer, carries the folder the file had before the phone renamed it. Decide whether a file edited offline should land back in a folder that was renamed away.',
  async run({ devices: { phone, laptop }, network, seed, converge, step, checkEqual, waitFor }) {
    const files = await step('phone adds 20 files in docs', () =>
      seed('phone', { count: 20, size: 512, dir: 'docs' }),
    )
    await step('both converge', () => converge())
    await network.setOffline('laptop', true)
    await step('phone renames the folder', async () => {
      const docs = await phone.call<{ id: string }>('directories.getByPath', 'docs')
      await phone.call('directories.rename', docs.id, 'archive')
    })
    await step('the folder rename reaches the network', () =>
      waitFor('every file to be under archive on the network', async () =>
        (await network.objects()).every((o) => o.metadata?.directory !== 'docs'),
      ),
    )
    await step('laptop renames one file inside it while offline', () =>
      laptop.call('files.renameFile', files[0].id, 'edited-offline.bin'),
    )
    await network.setOffline('laptop', false)
    await step('both converge', () => converge(undefined, { timeoutMs: 90_000 }))
    for (const device of [phone, laptop]) {
      const library = await device.library()
      checkEqual(
        `only the edited file is in docs on ${device.name}`,
        library.filter((f) => f.dir === 'docs').map((f) => f.name),
        ['edited-offline.bin'],
      )
      checkEqual(
        `the other 19 are in archive on ${device.name}`,
        library.filter((f) => f.dir === 'archive').length,
        19,
      )
    }
  },
})
