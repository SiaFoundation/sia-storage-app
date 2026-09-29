import { defineScenario } from '../../src/scenario'
import { uploadInFlight } from '../steps'

export default defineScenario({
  name: 'killing a device mid-upload loses nothing and uploads nothing twice',
  description:
    'The network is slowed to 2 MB/s and the phone adds 6 files of 1 MB. The phone daemon is killed while uploading, then restarted. Every file reaches the laptop, and the network holds exactly one pinned object per file.',
  devices: { phone: 'cli', laptop: 'cli' },
  timeoutMs: 3 * 60_000,
  async run(ctx) {
    const {
      devices: { phone },
      network,
      seed,
      converge,
      step,
      checkEqual,
      checkContent,
    } = ctx
    await network.setConditions({ uploadBytesPerSec: 2 * 1024 * 1024 })
    const files = await step('phone adds 6 files of 1 MB', () =>
      seed('phone', { count: 6, size: 1024 * 1024 }),
    )
    await uploadInFlight(ctx, 'phone', files.length)
    await step('kill the phone daemon', () => phone.kill())
    await step('restart it', () => phone.start())
    await network.setConditions({ uploadBytesPerSec: 0 })
    await step('both converge', () => converge(undefined, { timeoutMs: 90_000 }))

    const pinned = await network.objects()
    checkEqual('one pinned object per file', pinned.length, files.length)
    checkEqual(
      'no content pinned twice',
      new Set(pinned.map((o) => o.contentHash)).size,
      files.length,
    )
    await checkContent()
  },
})
