import { defineScenario } from '../../src/scenario'
import { sha256 } from '../../src/integrity'

export default defineScenario({
  name: 'a Finder edit made offline while another device trashes the file keeps the edit and ends agreed',
  description:
    'The Mac goes offline and saves new bytes over a file while the phone trashes it. After the Mac reconnects both devices agree on the file’s trash state and the Mac’s bytes are on the network.',
  devices: { mac: 'cli', phone: 'cli' },
  async run({ devices, network, seed, converge, step, check, note, checkContent, waitFor }) {
    const mac = devices.mac
    const [file] = await step('Mac adds a file', () => seed('mac', { count: 1, size: 4096 }))
    await step('both converge', () => converge())
    await network.setOffline('mac', true)
    const edit = crypto.getRandomValues(new Uint8Array(4200))
    await step('Mac saves new bytes while offline', () =>
      mac.call('provider.write', file.id, mac.stage(edit)),
    )
    await step('phone trashes the file', () => devices.phone.call('files.trashFile', file.id))
    await step('the trash reaches the network', () =>
      waitFor('the object to be marked trashed', async () =>
        (await network.objects()).some((o) => o.metadata?.id === file.id && o.metadata?.trashedAt),
      ),
    )
    await network.setOffline('mac', false)
    await step('both converge', () => converge(undefined, { timeoutMs: 90_000 }))
    const current = (await devices.phone.library()).filter((f) => f.name === file.name && f.current)
    note(
      `after reconnecting, the current version is ${current[0]?.trashed ? 'trashed' : 'not trashed'}`,
    )
    check(
      'the Mac’s edit is on the network',
      (await network.objects()).some((o) => o.contentHash === sha256(edit)),
    )
    await checkContent()
  },
})
