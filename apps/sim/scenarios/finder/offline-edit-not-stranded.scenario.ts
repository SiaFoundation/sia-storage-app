import { defineScenario } from '../../src/scenario'
import { sha256 } from '../../src/integrity'

export default defineScenario({
  name: 'a Finder edit made offline still reaches the network after another device saves a newer version',
  description:
    'The Mac goes offline and saves new bytes over a synced file through Finder. The phone then adds a newer version of the same file. When the Mac reconnects, its edit is uploaded as a version rather than stranded on the Mac, and both devices agree.',
  devices: { mac: 'cli', phone: 'cli' },
  async run({ devices, network, seed, converge, step, check, checkContent, workDir }) {
    const mac = devices.mac
    const [file] = await step('phone adds a file', () => seed('phone', { count: 1, size: 4096 }))
    await step('both converge', () => converge())

    await network.setOffline('mac', true)
    const macEdit = crypto.getRandomValues(new Uint8Array(5000))
    await step('Mac saves an edit through Finder while offline', () =>
      mac.call('provider.write', file.id, mac.stage(macEdit)),
    )
    const phoneEdit = crypto.getRandomValues(new Uint8Array(6000))
    const phonePath = `${workDir}/${file.name}`
    await Bun.write(phonePath, phoneEdit)
    await step('phone adds a newer version of the same file', () =>
      devices.phone.addFile(phonePath),
    )
    await network.setOffline('mac', false)
    await step('both converge', () => converge(undefined, { timeoutMs: 90_000 }))

    const hashes = (await network.objects()).map((o) => o.contentHash)
    check('the Mac’s offline edit reached the network', hashes.includes(sha256(macEdit)))
    check('the phone’s newer version reached the network', hashes.includes(sha256(phoneEdit)))
    await checkContent()
  },
})
