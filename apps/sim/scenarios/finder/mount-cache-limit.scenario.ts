import { defineScenario } from '../../src/scenario'

const SIZE = 100_000

export default defineScenario({
  name: 'a PC’s cache limit has its folder’s provider remove the least recently used files, and still does after the daemon restarts',
  description:
    'The PC’s folder is served by a provider that stays connected to the daemon, as a Windows sync root provider does. The PC opens 4 files through the folder, one after another, then the first again, and creates one more with its uploads held, so that one is not uploaded. With the limit at 300 kB an eviction pass asks the provider to remove the two uploaded files opened longest ago and nothing else. The daemon then restarts and the provider connects again. With the limit at 0 and one file answered as busy, a pass asks about the two uploaded files left, and the busy one and the one not uploaded stay.',
  devices: { pc: 'cli', laptop: 'cli' },
  async run({ devices, network, seed, converge, step, precondition, checkEqual }) {
    const { pc } = devices
    const folder = pc.mount()
    await step('the PC’s folder is registered', () => folder.attach())
    const files = await step('the laptop adds 4 files', () =>
      seed('laptop', { count: 4, size: SIZE }),
    )
    await step('both converge', () => converge())
    await step('the PC opens each through its folder, then the first again', async () => {
      for (const f of files) {
        await folder.open(f.id)
        await Bun.sleep(20)
      }
      await folder.open(files[0].id)
    })
    await step('the network holds the PC’s uploads', () =>
      network.hold({ op: 'upload', device: 'pc' }),
    )
    const waiting = await step('a file is created in the folder', () =>
      folder.create('waiting.bin', crypto.getRandomValues(new Uint8Array(SIZE))),
    )
    await precondition('it is not uploaded', async () =>
      (await pc.library()).some((f) => f.id === waiting.id && !f.uploaded),
    )
    checkEqual('the PC counts 500 kB', await pc.call<number>('cache.bytesOnDevice'), 5 * SIZE)

    await step('the cache limit is 300 kB with no minimum age', async () => {
      await pc.cli('config', 'set', 'cacheMaxBytes', '300KB')
      await pc.cli('config', 'set', 'cacheMinAge', '0')
    })
    await step('one eviction pass runs', () => pc.call('cache.evict'))

    checkEqual(
      'the provider was asked about the two files opened longest ago',
      [...folder.asked].sort(),
      [files[1].id, files[2].id].sort(),
    )
    checkEqual(
      'the folder keeps the file opened again, the newest and the one not uploaded',
      folder.held().sort(),
      [files[0].id, files[3].id, waiting.id].sort(),
    )
    checkEqual('the PC is at its limit', await pc.call<number>('cache.bytesOnDevice'), 3 * SIZE)

    await step('the PC’s daemon restarts and the provider connects again', async () => {
      await pc.stop()
      await pc.start()
      await folder.connect()
    })
    checkEqual(
      'the PC still counts what its folder holds',
      await pc.call<number>('cache.bytesOnDevice'),
      3 * SIZE,
    )

    const askedBefore = folder.asked.length
    folder.keep(files[3].id, 'busy')
    await step('the limit is 0 and a pass runs with one file busy', async () => {
      await pc.cli('config', 'set', 'cacheMaxBytes', '0')
      await pc.call('cache.evict')
    })
    checkEqual(
      'the provider was asked about the two uploaded files only',
      folder.asked.slice(askedBefore).sort(),
      [files[0].id, files[3].id].sort(),
    )
    checkEqual(
      'the busy file and the one not uploaded stay',
      folder.held().sort(),
      [files[3].id, waiting.id].sort(),
    )
    const cached = (
      await pc.sql<{ fileId: string }>(
        "SELECT fs.fileId FROM fs JOIN files f ON f.id = fs.fileId WHERE f.kind = 'file'",
      )
    ).map((r) => r.fileId)
    checkEqual('the file not uploaded keeps its cache copy', cached, [waiting.id])

    await step('the network lets the uploads through', () => network.releaseHolds())
    await step('both converge', () => converge(undefined, { timeoutMs: 90_000 }))
  },
})
