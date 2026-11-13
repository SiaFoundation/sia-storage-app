import { defineScenario } from '../../src/scenario'

const SIZE = 100_000
/** The hold the first pass uses, long enough to cover the steps between the opens and the pass. */
const HOLD_S = 10

export default defineScenario({
  name: 'a PC has its folder’s provider remove the files unused past the hold, and after the daemon restarts it reads again what the folder holds',
  description:
    'The PC’s folder is served by a provider that stays connected to the daemon, as a Windows sync root provider does. The PC opens 2 files through the folder, waits past a 10-second hold, opens 2 more, and creates one with its uploads held, so that one is not uploaded. With the hold at 10 seconds an eviction pass asks the provider to remove the two files opened before the wait and nothing else. The daemon then stops, the folder lets go of one more file with no daemon to tell, and the daemon starts and the provider connects again. With no hold and one file answered as busy, a pass asks the provider which files it holds, forgets the one that went, and asks it to remove only the uploaded file left, and the busy one and the one not uploaded stay.',
  devices: { pc: 'cli', laptop: 'cli' },
  async run({ devices, network, seed, converge, step, precondition, checkEqual }) {
    const { pc } = devices
    const folder = pc.mount()
    await step('the PC’s folder is registered', () => folder.attach())
    const files = await step('the laptop adds 4 files', () =>
      seed('laptop', { count: 4, size: SIZE }),
    )
    await step('both converge', () => converge())
    await step('the PC opens two files through its folder', async () => {
      await folder.open(files[1].id)
      await folder.open(files[2].id)
    })
    await step('those two go unused past the hold', () => Bun.sleep((HOLD_S + 1) * 1000))
    await step('the PC opens the other two', async () => {
      await folder.open(files[0].id)
      await folder.open(files[3].id)
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

    await step('the hold is 10 seconds and one eviction pass runs', async () => {
      await pc.cli('config', 'set', 'cacheMinAge', `${HOLD_S}s`)
      await pc.call('cache.evict')
    })

    checkEqual(
      'the provider was asked about the two files opened before the wait',
      [...folder.asked].sort(),
      [files[1].id, files[2].id].sort(),
    )
    checkEqual(
      'the folder keeps the two opened since and the one not uploaded',
      folder.held().sort(),
      [files[0].id, files[3].id, waiting.id].sort(),
    )
    checkEqual(
      'the PC counts the three left',
      await pc.call<number>('cache.bytesOnDevice'),
      3 * SIZE,
    )

    await step('the daemon stops, the folder lets go of a file, and both come back', async () => {
      await pc.stop()
      folder.drop(files[0].id)
      await pc.start()
      await folder.connect()
    })
    checkEqual(
      'the PC still counts what its folder held when the daemon stopped',
      await pc.call<number>('cache.bytesOnDevice'),
      3 * SIZE,
    )

    const askedBefore = folder.asked.length
    folder.keep(files[3].id, 'busy')
    await step('the hold is 0 and a pass runs with one file busy', async () => {
      await pc.cli('config', 'set', 'cacheMinAge', '0')
      await pc.call('cache.evict')
    })
    checkEqual(
      'the provider was asked to remove only the uploaded file it still holds',
      folder.asked.slice(askedBefore),
      [files[3].id],
    )
    checkEqual(
      'the PC counts the two files its folder holds',
      await pc.call<number>('cache.bytesOnDevice'),
      2 * SIZE,
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
