import { readFileSync } from 'node:fs'
import { fileHash, sha256 } from '../../src/integrity'
import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'a rename on one device and an offline Finder edit on another leave the renamed file and a new file with the edit',
  description:
    'The Mac goes offline and saves new bytes over a file through Finder while the phone renames it. After the Mac reconnects both devices agree on two current files: the renamed one with the original bytes, and one under the old name with the Mac’s bytes. Nothing is lost.',
  devices: { mac: 'cli', phone: 'cli' },
  needsReview:
    'Versions are grouped by name and folder, so the rename moves the original into its own group and the offline save starts a version under the old name. Decide whether an edit should follow a file that was renamed elsewhere.',
  async run({ devices, network, seed, converge, step, checkEqual, checkContent, waitFor }) {
    const mac = devices.mac
    const [file] = await step('Mac adds a file', () => seed('mac', { count: 1, size: 4096 }))
    await step('both converge', () => converge())
    await network.setOffline('mac', true)
    const edit = crypto.getRandomValues(new Uint8Array(5000))
    await step('Mac saves new bytes while offline', () =>
      mac.call('provider.write', file.id, mac.stage(edit)),
    )
    await step('phone renames the file', () =>
      devices.phone.call('files.renameFile', file.id, 'renamed.bin'),
    )
    await step('the rename reaches the network', () =>
      waitFor('the new name on the network', async () =>
        (await network.objects()).some((o) => o.metadata?.name === 'renamed.bin'),
      ),
    )
    await network.setOffline('mac', false)
    await step('both converge', () => converge(undefined, { timeoutMs: 90_000 }))
    const original = sha256(readFileSync(file.path))
    for (const device of [devices.mac, devices.phone]) {
      const current = (await device.library())
        .filter((f) => f.current)
        .map((f) => [f.name, fileHash(f.hash)])
        .sort()
      checkEqual(
        `${device.name} has the renamed original and the edit under the old name`,
        current,
        [
          [file.name, sha256(edit)],
          ['renamed.bin', original],
        ].sort(),
      )
    }
    await checkContent()
  },
})
