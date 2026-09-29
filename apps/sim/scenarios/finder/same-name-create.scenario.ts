import { sha256 } from '../../src/integrity'
import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'two devices creating the same file name in the same folder keep both files’ bytes',
  description:
    'While the Mac is offline, the phone adds IMG_0001.JPG to cam and the Mac creates its own IMG_0001.JPG in cam through Finder. After the Mac reconnects both devices agree and both photos’ bytes are on the network.',
  devices: { mac: 'cli', phone: 'cli' },
  async run({ devices, network, converge, step, check, checkContent, workDir }) {
    const mac = devices.mac
    await network.setOffline('mac', true)
    const phonePhoto = crypto.getRandomValues(new Uint8Array(3000))
    await Bun.write(`${workDir}/IMG_0001.JPG`, phonePhoto)
    await step('phone adds IMG_0001.JPG to cam', () =>
      devices.phone.addFile(`${workDir}/IMG_0001.JPG`, { dir: 'cam' }),
    )
    const macPhoto = crypto.getRandomValues(new Uint8Array(3100))
    await step('Mac creates its own IMG_0001.JPG in cam through Finder', async () => {
      const dir = await mac.call<{ id: string }>('provider.create', null, 'cam', 'dir')
      await mac.call('provider.create', dir.id, 'IMG_0001.JPG', 'file', mac.stage(macPhoto))
    })
    await network.setOffline('mac', false)
    await step('both converge', () => converge(undefined, { timeoutMs: 90_000 }))
    const hashes = new Set((await network.objects()).map((o) => o.contentHash))
    check(
      'both photos are on the network',
      hashes.has(sha256(phonePhoto)) && hashes.has(sha256(macPhoto)),
    )
    await checkContent()
  },
})
