import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: "a rename and a delete in the Mac's Finder folder show up on a laptop",
  description:
    'The laptop adds two files. On the Mac, one is renamed and the other deleted through the Finder folder. The laptop ends with the first under its new name and the second in the trash.',
  devices: { mac: 'desktop', laptop: 'cli' },
  timeoutMs: 8 * 60_000,
  async run({ devices, seed, converge, step, checkEqual, waitFor }) {
    const { mac, laptop } = devices
    const [kept, removed] = await step('laptop adds 2 files', () =>
      seed('laptop', { count: 2, size: 64 * 1024 }),
    )
    await step('both converge', () => converge())
    await step('the files appear in the Finder folder', () =>
      waitFor(
        'the Finder folder to list them',
        () => mac.finderList().includes(kept.name) && mac.finderList().includes(removed.name),
        { timeoutMs: 60_000, intervalMs: 500 },
      ),
    )
    await step('rename one in Finder', () => mac.finderRename(kept.name, 'renamed.bin'))
    await step('delete the other in Finder', () => mac.finderRemove(removed.name))
    await step('the laptop sees both changes', () =>
      waitFor(
        'the rename and the trash on the laptop',
        async () => {
          const lib = await laptop.library()
          const byId = new Map(lib.map((f) => [f.id, f]))
          return byId.get(kept.id)?.name === 'renamed.bin' && byId.get(removed.id)?.trashed === true
        },
        { timeoutMs: 120_000, intervalMs: 1000 },
      ),
    )
    await step('both converge', () => converge())
    const lib = new Map((await laptop.library()).map((f) => [f.id, f]))
    checkEqual('the laptop shows the new name', lib.get(kept.id)?.name, 'renamed.bin')
    checkEqual('the laptop shows the deleted file in the trash', lib.get(removed.id)?.trashed, true)
  },
})
