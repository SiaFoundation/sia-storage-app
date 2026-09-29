import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'edits made offline survive a kill before they sync, and a delete beats a peer’s rename',
  description:
    'The phone goes offline, deletes one file, trashes another and renames a third, and the laptop renames the deleted file. The phone is killed and restarted before it reconnects. After it reconnects, the deleted file is gone everywhere, the trashed one is trashed and the rename holds on both devices.',
  devices: { phone: 'cli', laptop: 'cli' },
  async run({
    devices: { phone, laptop },
    network,
    seed,
    converge,
    step,
    check,
    checkEqual,
    precondition,
    waitFor,
  }) {
    const [x, y, z] = await step('phone adds 3 files', () =>
      seed('phone', { count: 3, size: 2048 }),
    )
    await step('both converge', () => converge())

    await network.setOffline('phone', true)
    await step('phone deletes, trashes and renames while offline', async () => {
      await phone.call('files.tombstoneFile', x.id)
      await phone.call('files.trashFile', y.id)
      await phone.call('files.renameFile', z.id, 'z-renamed.bin')
    })
    await step('laptop renames the file the phone deleted', () =>
      laptop.call('files.renameFile', x.id, 'peer-renamed.bin'),
    )
    // The rename has to be on the network before the phone's delete, or the
    // laptop's edit meets a deleted object and the race under test never runs.
    await precondition('the laptop’s rename reaches the network', () =>
      waitFor('the laptop’s rename on the network', async () =>
        (await network.objects()).some(
          (o) => o.metadata?.id === x.id && o.metadata?.name === 'peer-renamed.bin',
        ),
      ),
    )
    await step('kill and restart the phone while still offline', async () => {
      await phone.kill()
      await phone.start()
    })
    await network.setOffline('phone', false)
    await step('both converge', () => converge(undefined, { timeoutMs: 90_000 }))

    const onLaptop = new Map((await laptop.library()).map((f) => [f.id, f]))
    check('the deleted file is gone from the laptop', !onLaptop.has(x.id))
    checkEqual('the trashed file is trashed on the laptop', onLaptop.get(y.id)?.trashed, true)
    checkEqual('the rename holds on the laptop', onLaptop.get(z.id)?.name, 'z-renamed.bin')
    check(
      'the deleted file is gone from the network',
      !(await network.objects()).some((o) => o.metadata?.id === x.id),
    )
  },
})
