import { defineScenario } from '../../src/scenario'
import { sha256 } from '../../src/integrity'

export default defineScenario({
  name: 'a Finder save based on an older version keeps the other device’s newer edit',
  description:
    'The Mac holds a file open. The phone saves a newer version of it. The Mac then saves its own edit of the older version through Finder. Both edits end up on the network, so neither user’s work is lost, and both devices agree.',
  devices: { mac: 'cli', phone: 'cli' },
  async run({ devices, seed, converge, step, check, checkContent, network, workDir }) {
    const mac = devices.mac
    const [file] = await step('phone adds a file', () => seed('phone', { count: 1, size: 4096 }))
    await step('both converge', () => converge())
    await step('Mac opens it in Finder', () =>
      mac.call('provider.fetch', file.id, mac.handoffTarget()),
    )

    const phoneEdit = crypto.getRandomValues(new Uint8Array(4500))
    await Bun.write(`${workDir}/${file.name}`, phoneEdit)
    await step('phone saves a newer version', () =>
      devices.phone.addFile(`${workDir}/${file.name}`),
    )
    await step('both converge', () => converge())

    const macEdit = crypto.getRandomValues(new Uint8Array(4800))
    await step('Mac saves its edit of the older version', () =>
      mac.call('provider.write', file.id, mac.stage(macEdit)),
    )
    await step('both converge', () => converge(undefined, { timeoutMs: 90_000 }))
    const hashes = (await network.objects()).map((o) => o.contentHash)
    check('the phone’s newer edit is on the network', hashes.includes(sha256(phoneEdit)))
    check('the Mac’s edit is on the network', hashes.includes(sha256(macEdit)))
    await checkContent()
  },
})
