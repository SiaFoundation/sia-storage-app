import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'files added on the phone and on a laptop reach both, and a rename on the phone reaches the laptop',
  description:
    'The phone imports 3 files through its picker path and the laptop adds 3. Both converge, the phone renames one of the laptop’s files, and the laptop ends with the new name. Every file on both points at its own bytes.',
  devices: { phone: 'phone', laptop: 'cli' },
  timeoutMs: 6 * 60_000,
  async run({ devices: { phone, laptop }, seed, converge, step, checkEqual, checkContent }) {
    await step('phone imports 3 files', () => seed('phone', { count: 3, size: 24 * 1024 }))
    const fromLaptop = await step('laptop adds 3 files', () =>
      seed('laptop', { count: 3, size: 24 * 1024 }),
    )
    const { files } = await step('both converge', () => converge(undefined, { timeoutMs: 120_000 }))
    checkEqual('both hold all 6 files', files, 6)

    await step('phone renames a laptop file', () =>
      phone.call('files.renameFile', fromLaptop[0].id, 'renamed-on-phone.txt'),
    )
    await step('both converge', () => converge(undefined, { timeoutMs: 120_000 }))
    const renamed = (await laptop.library()).find((f) => f.id === fromLaptop[0].id)
    checkEqual('laptop shows the phone’s rename', renamed?.name, 'renamed-on-phone.txt')
    await checkContent()
  },
})
