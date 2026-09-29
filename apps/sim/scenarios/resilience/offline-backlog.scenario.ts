import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'files added while offline upload once the device reconnects',
  description:
    'The phone goes offline and adds 20 files, and shows none of them as uploaded while it is offline. After it reconnects all 20 upload once and reach the laptop.',
  devices: { phone: 'cli', laptop: 'cli' },
  async run({ devices, network, seed, converge, step, waitFor, check, checkEqual, checkContent }) {
    await network.setOffline('phone', true)
    const files = await step('phone adds 20 files offline', () =>
      seed('phone', { count: 20, size: 4096 }),
    )
    await step('the phone tries to upload and is refused', () =>
      waitFor('an upload from the phone to fail offline', async () =>
        (await network.requests({ device: 'phone', op: 'upload' })).some((r) => r.status === 503),
      ),
    )
    check(
      'the phone shows no file as uploaded while offline',
      (await devices.phone.library()).every((f) => !f.uploaded),
    )
    await network.setOffline('phone', false)
    await step('both converge', () => converge(undefined, { timeoutMs: 90_000 }))
    const pinned = await network.objects()
    checkEqual('all 20 files are on the network', pinned.length, files.length)
    check(
      'no content pinned twice',
      new Set(pinned.map((o) => o.contentHash)).size === files.length,
    )
    await checkContent()
  },
})
