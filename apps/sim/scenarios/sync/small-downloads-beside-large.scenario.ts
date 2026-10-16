import { defineScenario } from '../../src/scenario'

const MiB = 1024 * 1024
const SMALL = 30

export default defineScenario({
  name: 'small downloads run beside two large ones instead of waiting for them',
  description:
    'Over a link with 200ms of latency per call and 16 MiB/s shared, a device starts two 40 MiB downloads and then 30 small ones. The small files are latency-bound and need little memory, so they all finish while the large downloads are still running.',
  devices: { laptop: 'cli', desk: 'cli' },
  timeoutMs: 4 * 60_000,
  async run({ devices: { desk }, network, seed, converge, step, check, note }) {
    const large = await step('laptop adds two 40 MiB files', () =>
      seed('laptop', { count: 2, size: 40 * MiB, prefix: 'large' }),
    )
    const small = await step(`laptop adds ${SMALL} files of 256 KiB`, () =>
      seed('laptop', { count: SMALL, size: 256 * 1024, prefix: 'small' }),
    )
    await step('both converge', () => converge())
    await step('slow the link', () =>
      network.setConditions({ latencyMs: 200, downloadBytesPerSec: 16 * MiB }),
    )

    const started = Date.now()
    const finished = (id: string) =>
      desk.call('downloads.downloadFile', id, 'user').then(() => Date.now() - started)
    const largeDone = large.map((f) => finished(f.id))
    // Queued after the large downloads, as when someone opens a folder of
    // photos while a video is downloading.
    const smallDone = small.map((f) => finished(f.id))
    const [largeMs, smallMs] = await step('desk downloads all of them', () =>
      Promise.all([Promise.all(largeDone), Promise.all(smallDone)]),
    )
    await network.setConditions({ latencyMs: 0, downloadBytesPerSec: 0 })

    const firstLarge = Math.min(...largeMs)
    const lastSmall = Math.max(...smallMs)
    note(`small files done by ${lastSmall}ms, large ones at ${largeMs.join('ms and ')}ms`)
    check(
      `all ${SMALL} small files finish before either large download`,
      lastSmall < firstLarge,
      `last small at ${lastSmall}ms, first large at ${firstLarge}ms`,
    )
  },
})
