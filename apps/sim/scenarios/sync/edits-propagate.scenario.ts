import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'a rename, a move into a folder and a trash on one device show up on the other',
  description:
    'The phone renames one file, moves another into a new folder and trashes a third. The laptop ends with the same names, folder and trash state, and the network metadata matches.',
  devices: { phone: 'cli', laptop: 'cli' },
  async run({ devices: { phone, laptop }, network, seed, converge, step, checkEqual }) {
    const [a, b, c] = await step('phone adds 3 files', () =>
      seed('phone', { count: 3, size: 4096 }),
    )
    await step('both converge', () => converge())

    await step('phone renames, moves and trashes', async () => {
      await phone.call('files.renameFile', a.id, 'renamed.txt')
      const docs = await phone.call<{ id: string }>('directories.getOrCreateAtPath', 'docs')
      await phone.call('files.moveFile', b.id, docs.id)
      await phone.call('files.trashFile', c.id)
    })
    await step('both converge', () => converge())

    const byId = new Map((await laptop.library()).map((f) => [f.id, f]))
    checkEqual('laptop shows the new name', byId.get(a.id)?.name, 'renamed.txt')
    checkEqual('laptop shows the file in docs', byId.get(b.id)?.dir, 'docs')
    checkEqual('laptop shows the file trashed', byId.get(c.id)?.trashed, true)

    const onNetwork = new Map((await network.objects()).map((o) => [o.metadata?.id, o.metadata]))
    checkEqual('network metadata carries the new name', onNetwork.get(a.id)?.name, 'renamed.txt')
    checkEqual('network metadata carries the folder', onNetwork.get(b.id)?.directory, 'docs')
    checkEqual(
      'network metadata marks the file trashed',
      typeof onNetwork.get(c.id)?.trashedAt,
      'number',
    )
  },
})
