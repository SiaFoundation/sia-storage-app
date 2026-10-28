import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'an eviction pass with no cache limit left keeps every file not yet uploaded',
  description:
    'The network holds the Mac’s uploads while it adds 5 files. With the cache limit at 0 and no minimum age, an eviction pass removes none of them, since their only copy is the Mac’s. Once uploads go through, the files reach the network.',
  devices: { mac: 'cli' },
  async run({ devices, network, seed, converge, step, precondition, checkEqual }) {
    const mac = devices.mac
    await step('the network holds the Mac’s uploads', () =>
      network.hold({ op: 'upload', device: 'mac' }),
    )
    const files = await step('the Mac adds 5 files', () => seed('mac', { count: 5, size: 50_000 }))
    await precondition('no file is uploaded', async () =>
      (await mac.library()).every((f) => !f.uploaded),
    )

    await step('the cache limit is 0 with no minimum age', async () => {
      await mac.cli('config', 'set', 'cacheMaxBytes', '0')
      await mac.cli('config', 'set', 'cacheMinAge', '0')
    })
    await step('one eviction pass runs', () => mac.call('cache.evict'))

    const cached = (await mac.sql<{ fileId: string }>('SELECT fileId FROM fs')).map((r) => r.fileId)
    checkEqual(
      'every file not yet uploaded keeps its copy',
      files.filter((f) => !cached.includes(f.id)).map((f) => f.name),
      [],
    )

    await step('the network lets the uploads through', () => network.releaseHolds())
    await step('the Mac finishes uploading', () => converge())
  },
})
