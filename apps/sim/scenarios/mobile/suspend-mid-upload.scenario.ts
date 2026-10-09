import { pinnedTwice } from '../../src/integrity'
import { defineScenario } from '../../src/scenario'
import { uploadInFlight } from '../steps'
import { suspendAndCheckLocks, suspensionErrors } from './phone'

export default defineScenario({
  name: 'a phone suspended mid-upload holds no database lock on iOS, then finishes every upload once',
  description:
    'Uploads are slowed to 48 KB/s and the phone imports 6 files of 512 KB. While it uploads it goes to the background. Once iOS has suspended it, it holds no write lock and no WAL read slot on its database, which is what gets a phone killed. Back in the foreground it finishes, the laptop gets every file, nothing is uploaded twice, and the log has no suspension error.',
  devices: { phone: 'phone', laptop: 'cli' },
  timeoutMs: 8 * 60_000,
  async run(ctx) {
    const { devices, network, seed, converge, step, checkEqual, checkContent } = ctx
    const phone = devices.phone
    // Slow enough that uploads are still running once every file has imported.
    await network.setConditions({ uploadBytesPerSec: 48 * 1024 })
    const files = await step('phone imports 6 files of 512 KB', () =>
      seed('phone', { count: 6, size: 512 * 1024 }),
    )
    await uploadInFlight(ctx, 'phone', files.length)
    await suspendAndCheckLocks(phone, ctx)

    await network.setConditions({ uploadBytesPerSec: 0 })
    await step('bring the phone back', () => phone.foreground())
    await step('both converge', () => converge(undefined, { timeoutMs: 180_000 }))
    const pinned = await network.objects()
    checkEqual('one pinned object per file', pinned.length, files.length)
    checkEqual('no file’s bytes are pinned twice', await pinnedTwice(network), [])
    await checkContent()
    checkEqual('the phone logged no suspension error', await suspensionErrors(phone), [])
  },
})
