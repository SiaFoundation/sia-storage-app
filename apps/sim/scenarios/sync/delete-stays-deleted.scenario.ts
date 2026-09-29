import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'a file deleted on one device stays deleted after an offline device edits it',
  description:
    'The laptop goes offline and renames a file the phone then permanently deletes. After the laptop reconnects the file is gone from both devices and the network, and the rename does not bring it back.',
  devices: { phone: 'cli', laptop: 'cli' },
  async run({
    devices: { phone, laptop },
    network,
    seed,
    converge,
    step,
    check,
    checkEqual,
    waitFor,
  }) {
    const [doomed, kept] = await step('phone adds 2 files', () =>
      seed('phone', { count: 2, size: 2048 }),
    )
    await step('both converge', () => converge())

    await step('laptop goes offline and renames the file', async () => {
      await network.setOffline('laptop', true)
      await laptop.call('files.renameFile', doomed.id, 'edited-offline.txt')
    })
    await step('phone deletes it permanently', () =>
      phone.call('files.tombstoneWithThumbnailsAndCleanup', [
        { id: doomed.id, type: 'application/octet-stream' },
      ]),
    )
    await step('the delete reaches the network', () =>
      waitFor('the object to be deleted', async () =>
        (await network.objects()).every((o) => o.metadata?.id !== doomed.id),
      ),
    )
    await step('laptop comes back', () => network.setOffline('laptop', false))
    await step('both converge', () => converge())

    for (const device of [phone, laptop]) {
      const ids = (await device.library()).map((f) => f.id)
      check(`${device.name} no longer has the deleted file`, !ids.includes(doomed.id))
      check(`${device.name} still has the other file`, ids.includes(kept.id))
    }
    checkEqual(
      'the network holds only the kept file',
      (await network.objects()).map((o) => o.metadata?.id),
      [kept.id],
    )
  },
})
