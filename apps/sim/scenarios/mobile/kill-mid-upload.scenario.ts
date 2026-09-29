import { pinnedTwice } from '../../src/integrity'
import { defineScenario } from '../../src/scenario'
import { uploadInFlight } from '../steps'

export default defineScenario({
  name: 'killing the phone mid-upload and relaunching it loses nothing and uploads nothing twice',
  description:
    'Uploads are slowed and the phone imports 5 files of 512 KB. The app is killed while uploading and relaunched. Every file reaches the laptop, each once, with its own bytes.',
  devices: { phone: 'phone', laptop: 'cli' },
  timeoutMs: 8 * 60_000,
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
    // Slow enough that uploads are still running once every file has imported.
    await network.setConditions({ uploadBytesPerSec: 48 * 1024 })
    const files = await step('phone imports 5 files of 512 KB', () =>
      seed('phone', { count: 5, size: 512 * 1024 }),
    )
    await uploadInFlight(ctx, 'phone', files.length)
    await step('kill the app', () => phone.kill())
    await network.setConditions({ uploadBytesPerSec: 0 })
    await step('relaunch it', () => phone.start())
    await step('both converge', () => converge(undefined, { timeoutMs: 180_000 }))
    checkEqual('one pinned object per file', (await network.objects()).length, files.length)
    checkEqual('no file’s bytes are pinned twice', await pinnedTwice(network), [])
    await checkContent()
  },
})
