import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'when two devices rename the same file while one is offline, the later rename wins everywhere',
  description:
    'The laptop goes offline. The phone renames a file, then the laptop renames the same file later. When the laptop reconnects both devices and the network settle on the laptop’s name.',
  devices: { phone: 'cli', laptop: 'cli' },
  async run({
    devices: { phone, laptop },
    network,
    seed,
    converge,
    step,
    checkEqual,
    checkContent,
    waitFor,
  }) {
    const [file] = await step('phone adds a file', () => seed('phone', { count: 1, size: 2048 }))
    await step('both converge', () => converge())

    await step('laptop goes offline', () => network.setOffline('laptop', true))
    await step('phone renames first', () =>
      phone.call('files.renameFile', file.id, 'phone-name.txt'),
    )
    await step('the phone’s rename reaches the network', () =>
      waitFor('the phone’s name on the network', async () =>
        (await network.objects()).some((o) => o.metadata?.name === 'phone-name.txt'),
      ),
    )
    await step('laptop renames later, while offline', () =>
      laptop.call('files.renameFile', file.id, 'laptop-name.txt'),
    )
    await step('laptop comes back', () => network.setOffline('laptop', false))
    await step('both converge', () => converge())

    const phoneName = (await phone.library()).find((f) => f.id === file.id)?.name
    checkEqual('phone ends with the later name', phoneName, 'laptop-name.txt')
    const [object] = await network.objects()
    checkEqual('network ends with the later name', object?.metadata?.name, 'laptop-name.txt')
    await checkContent()
  },
})
