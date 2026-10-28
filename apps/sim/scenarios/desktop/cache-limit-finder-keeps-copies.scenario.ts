import { fileHash, sha256 } from '../../src/integrity'
import { defineScenario } from '../../src/scenario'

const NAMES = ['one.bin', 'two.bin', 'three.bin']

export default defineScenario({
  name: 'evicting the cache on the Mac leaves Finder its copies, and a save in Finder still reaches the laptop',
  description:
    'Three files saved into the Finder folder upload. With the cache limit at 0 and no minimum age, an eviction pass removes the daemon’s copies, and Finder still holds and opens every file with its bytes without downloading. A file saved over in Finder afterwards reaches the laptop with the new bytes. The status window’s On this Mac row reads what is cached against the limit of 0.',
  devices: { mac: 'desktop', laptop: 'cli' },
  timeoutMs: 8 * 60_000,
  async run({ devices, converge, step, precondition, check, checkEqual, waitFor }) {
    const { mac, laptop } = devices
    const contents = new Map(
      NAMES.map((name) => [name, crypto.getRandomValues(new Uint8Array(64 * 1024))]),
    )
    await step('three files are saved into the Finder folder', async () => {
      for (const [name, bytes] of contents) await mac.finderWrite(name, bytes)
    })
    await precondition('every file is uploaded', () =>
      waitFor(
        'the three files to upload',
        async () => {
          const library = await mac.library()
          return NAMES.every((n) => library.some((f) => f.name === n && f.uploaded))
        },
        { timeoutMs: 120_000, intervalMs: 1000 },
      ),
    )

    await step('the cache limit is 0 with no minimum age', async () => {
      await mac.cli('config', 'set', 'cacheMaxBytes', '0')
      await mac.cli('config', 'set', 'cacheMinAge', '0')
    })
    await step('one eviction pass runs', () => mac.call('cache.evict'))

    const ids = (await mac.library()).filter((f) => NAMES.includes(f.name)).map((f) => f.id)
    const cached = (await mac.sql<{ fileId: string }>('SELECT fileId FROM fs')).map((r) => r.fileId)
    checkEqual(
      'the daemon holds none of the three',
      ids.filter((id) => cached.includes(id)),
      [],
    )
    checkEqual(
      'Finder still holds every file',
      NAMES.filter((n) => mac.isCloudOnly(n)),
      [],
    )
    const wrong = []
    for (const [name, bytes] of contents) {
      if (sha256(await mac.finderRead(name)) !== sha256(bytes)) wrong.push(name)
    }
    checkEqual('Finder opens every file with its bytes', wrong, [])

    const edited = crypto.getRandomValues(new Uint8Array(32 * 1024))
    await step('one.bin is saved over in Finder', () => mac.finderWrite('one.bin', edited))
    await step('the laptop gets the new version', () =>
      waitFor(
        'one.bin with the new bytes on the laptop',
        async () =>
          (await laptop.library()).some(
            (f) =>
              f.name === 'one.bin' &&
              f.current &&
              f.uploaded &&
              fileHash(f.hash) === sha256(edited),
          ),
        { timeoutMs: 120_000, intervalMs: 1000 },
      ),
    )
    await step('both converge', () => converge())

    await step('the status window opens', () => mac.openWindow())
    const row = await mac.ui().window('main').read({ id: 'on-this-mac' })
    check(
      'On this Mac reads the cache against its limit of 0',
      /^.+ of 0 bytes$/.test(row ?? ''),
      `${row}`,
    )
  },
})
