import { pinnedTwice } from '../../src/integrity'
import { defineScenario } from '../../src/scenario'
import { uploadInFlight } from '../steps'
import { suspensionErrors } from './phone'

export default defineScenario({
  name: 'switching away from the phone and back five times during uploads uploads every file once',
  description:
    'Uploads are slowed and the phone imports 6 files of 512 KB. It goes to the background and back five times, 700 ms apart, while they upload. Every file uploads once, both devices agree, and the phone logs no suspension error.',
  devices: { phone: 'phone', laptop: 'cli' },
  intermittentBug:
    'The uploader can queue a file that a database poll is about to return as well, so the file is added to the batch twice, uploaded twice and pinned twice.',
  bugShowsAs: [
    { check: 'one pinned object per file', matches: (pins: number) => pins > 6 },
    { check: 'no file’s bytes are pinned twice', matches: (hashes: string[]) => hashes.length > 0 },
  ],
  timeoutMs: 8 * 60_000,
  async run(ctx) {
    const { devices, network, seed, converge, step, checkEqual, checkContent } = ctx
    const phone = devices.phone
    await network.setConditions({ uploadBytesPerSec: 64 * 1024 })
    const files = await step('phone imports 6 files of 512 KB', () =>
      seed('phone', { count: 6, size: 512 * 1024 }),
    )
    await uploadInFlight(ctx, 'phone', files.length)
    await step('switch away and back five times', async () => {
      for (let i = 0; i < 5; i++) {
        await phone.background()
        await Bun.sleep(700)
        await phone.foreground()
        await Bun.sleep(700)
      }
    })
    await network.setConditions({ uploadBytesPerSec: 0 })
    await step('both converge', () => converge(undefined, { timeoutMs: 180_000 }))
    checkEqual('one pinned object per file', (await network.objects()).length, files.length)
    checkEqual('no file’s bytes are pinned twice', await pinnedTwice(network), [])
    checkEqual('the phone logged no suspension error', await suspensionErrors(phone), [])
    await checkContent()
  },
})
