import { readFileSync } from 'node:fs'
import { sha256 } from '../../src/integrity'
import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'opening 25 files through Finder while eviction runs over and over returns every file whole',
  description:
    'The phone adds 25 files and the Mac’s cache limit is 0 with no minimum age, so every pass tries to remove every copy the Mac holds. The Mac opens all 25 the way Finder does while eviction passes run back to back. Every open returns the bytes the phone added, because a pass skips a file while it downloads or while Finder exports it.',
  devices: { mac: 'cli', phone: 'cli' },
  async run({ devices, seed, converge, step, checkEqual }) {
    const mac = devices.mac
    const files = await step('the phone adds 25 files', () =>
      seed('phone', { count: 25, size: 128 * 1024 }),
    )
    await step('both converge', () => converge())
    await step('the Mac’s cache limit is 0 with no minimum age', async () => {
      await mac.cli('config', 'set', 'cacheMaxBytes', '0')
      await mac.cli('config', 'set', 'cacheMinAge', '0')
    })

    let opening = true
    const evicting = (async () => {
      let passes = 0
      while (opening) {
        await mac.call('cache.evict')
        passes += 1
      }
      return passes
    })()
    const targets = files.map(() => mac.handoffTarget())
    const results = await step('the Mac opens all 25 at once', () =>
      Promise.allSettled(files.map((f, i) => mac.call('provider.fetch', f.id, targets[i]))),
    )
    opening = false
    await step('the eviction loop stops', () => evicting)

    checkEqual(
      'every open succeeds',
      results.flatMap((r, i) =>
        r.status === 'rejected' ? [`${files[i].name}: ${(r.reason as Error).message}`] : [],
      ),
      [],
    )
    checkEqual(
      'every open has the bytes the phone added',
      files
        .filter(
          (f, i) =>
            results[i].status === 'fulfilled' &&
            sha256(readFileSync(targets[i])) !== sha256(readFileSync(f.path)),
        )
        .map((f) => f.name),
      [],
    )
  },
})
