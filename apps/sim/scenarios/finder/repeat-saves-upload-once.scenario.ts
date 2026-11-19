import { defineScenario } from '../../src/scenario'
import { sha256 } from '../../src/integrity'

export default defineScenario({
  name: 'a burst of quick Finder saves uploads the last save, not every save',
  description:
    'The Mac saves new bytes over a synced file through Finder six times, a second apart, the way an app with autosave does. Every save after the first follows the one before it within the quiet period, so each is held and the next replaces it. Once the saves stop, only the last held save uploads: the four held in between never reach the network or the phone, and both devices end on the last save.',
  devices: { mac: 'cli', phone: 'cli' },
  async run({ devices, network, seed, converge, step, check, checkContent }) {
    const mac = devices.mac
    const [file] = await step('phone adds a file', () => seed('phone', { count: 1, size: 4096 }))
    await step('both converge', () => converge())

    const saves = Array.from({ length: 6 }, (_, i) =>
      crypto.getRandomValues(new Uint8Array(5000 + i)),
    )
    await step('Mac saves the file six times through Finder, a second apart', async () => {
      for (const bytes of saves) {
        await mac.call('provider.write', file.id, mac.stage(bytes))
        await Bun.sleep(1000)
      }
    })
    await step('both converge', () => converge(undefined, { timeoutMs: 90_000 }))

    const hashes = new Set((await network.objects()).map((o) => o.contentHash))
    check('the last save reached the network', hashes.has(sha256(saves[5])))
    check(
      'none of the four saves replaced while held reached the network',
      saves.slice(1, 5).every((bytes) => !hashes.has(sha256(bytes))),
    )
    const macVersions = (await mac.library()).filter((f) => f.name === file.name)
    check(
      'the Mac keeps no version for the saves replaced while held',
      macVersions.every((f) => !saves.slice(1, 5).some((bytes) => f.hash.endsWith(sha256(bytes)))),
    )
    await checkContent()
  },
})
