import { defineScenario } from '../../src/scenario'
import { fileHash, sha256 } from '../../src/integrity'
import { uploadInFlight } from '../steps'

export default defineScenario({
  name: 'a Finder save survives the daemon being killed before its upload, and the other device gets the new bytes',
  description:
    'The Mac saves new bytes over a synced file the way the Finder extension does (provider.write). Uploads are slowed so the daemon is killed before the new bytes leave. After a restart the new bytes reach the network, the phone’s current version holds them, and every file points at its own bytes.',
  devices: { mac: 'cli', phone: 'cli' },
  async run({
    devices,
    network,
    seed,
    converge,
    step,
    precondition,
    check,
    checkEqual,
    checkContent,
    waitFor,
  }) {
    const mac = devices.mac
    const [file] = await step('Mac adds a file', () => seed('mac', { count: 1, size: 64 * 1024 }))
    await step('both converge', () => converge())

    const saved = crypto.getRandomValues(new Uint8Array(70 * 1024))
    await network.setConditions({ uploadBytesPerSec: 8 * 1024 })
    await step('Finder saves new bytes over it', () =>
      mac.call('provider.write', file.id, mac.stage(saved)),
    )
    // The original file is already pinned, so the saved bytes make the second object.
    await uploadInFlight({ precondition, network, waitFor }, 'mac', 2)
    await step('kill the Mac daemon before the upload finishes', () => mac.kill())
    await precondition('the kill lands before the saved bytes are pinned', async () =>
      (await network.objects()).every((o) => o.contentHash !== sha256(saved)),
    )
    await network.setConditions({ uploadBytesPerSec: 0 })
    await step('restart it', () => mac.start())
    await step('both converge', () => converge(undefined, { timeoutMs: 90_000 }))

    const hashes = (await network.objects()).map((o) => o.contentHash)
    check('the saved bytes reached the network', hashes.includes(sha256(saved)))
    const current = (await devices.phone.library()).filter((f) => f.name === file.name && f.current)
    checkEqual(
      'the phone’s current version holds the saved bytes',
      current.map((f) => fileHash(f.hash)),
      [sha256(saved)],
    )
    await checkContent()
  },
})
