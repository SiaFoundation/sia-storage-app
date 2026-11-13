import { closeSync, openSync } from 'node:fs'
import { fileHash, sha256 } from '../../src/integrity'
import { defineScenario } from '../../src/scenario'

const NAMES = ['one.bin', 'two.bin', 'three.bin']

export default defineScenario({
  name: 'the Mac keeps one copy of each uploaded file, the cache limit has Finder drop it, and a save in Finder still reaches the laptop',
  description:
    'Three files saved into the Finder folder upload, and the Mac’s daemon then removes its cache copy of each, since Finder holds them. With the cache limit at 0 and no minimum age, an eviction pass has the Finder agent evict Finder’s copy of each file. One file is held open by another process, so the system refuses to evict it and it stays. Finder then opens every file again with its bytes, a save over one of them reaches the laptop, and the status window reads what is on this Mac against the limit.',
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

    const cachedNames = async () => {
      const library = await mac.library()
      const cached = (await mac.sql<{ fileId: string }>('SELECT fileId FROM fs')).map(
        (r) => r.fileId,
      )
      return NAMES.filter((n) => library.some((f) => f.name === n && cached.includes(f.id)))
    }
    const recordedNames = async () => {
      const library = await mac.library()
      const held = (await mac.sql<{ fileId: string }>('SELECT fileId FROM mount_copies')).map(
        (r) => r.fileId,
      )
      return NAMES.filter((n) => library.some((f) => f.name === n && held.includes(f.id)))
    }
    await waitFor(
      'the daemon to remove its cache copy of each uploaded file',
      async () => (await cachedNames()).length === 0,
      { timeoutMs: 30_000, intervalMs: 500 },
    )
    checkEqual('the daemon has all three recorded as held by Finder', await recordedNames(), NAMES)
    checkEqual(
      'Finder holds all three',
      NAMES.filter((n) => !mac.isCloudOnly(n)),
      NAMES,
    )

    await step('the cache limit is 0 with no minimum age', async () => {
      await mac.cli('config', 'set', 'cacheMaxBytes', '0')
      await mac.cli('config', 'set', 'cacheMinAge', '0')
    })
    await step('one eviction pass runs while another process has three.bin open', async () => {
      const open = openSync(mac.finderPath('three.bin'), 'r')
      try {
        await mac.call('cache.evict')
      } finally {
        closeSync(open)
      }
    })

    checkEqual('the daemon has no cache copy of any of them', await cachedNames(), [])
    checkEqual('the daemon has only the open file recorded', await recordedNames(), ['three.bin'])
    checkEqual(
      'Finder holds only the open file',
      NAMES.filter((n) => !mac.isCloudOnly(n)),
      ['three.bin'],
    )
    const wrong = []
    for (const [name, bytes] of contents) {
      if (sha256(await mac.finderRead(name)) !== sha256(bytes)) wrong.push(name)
    }
    checkEqual('Finder opens every file again with its bytes', wrong, [])

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
      'On this Mac reads what the Mac holds against its limit of 0',
      /^.+ of 0 bytes$/.test(row ?? ''),
      `${row}`,
    )
  },
})
