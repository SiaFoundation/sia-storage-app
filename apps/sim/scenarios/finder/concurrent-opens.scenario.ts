import { readFileSync } from 'node:fs'
import { sha256 } from '../../src/integrity'
import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'opening 25 cloud-only files at once through the Finder provider downloads every one and leaves none stuck',
  description:
    'The phone adds 25 files. The Mac’s daemon, which has never downloaded them, fetches all 25 at once through provider.fetch, the call a Finder open makes. Every fetch succeeds with the bytes the phone added, and no download is left in progress.',
  devices: { mac: 'cli', phone: 'cli' },
  knownBug:
    'provider.fetch downloads at the background auto-download priority, whose queue keeps 20 and evicts the oldest, so an open whose download is evicted fails with "Local copy is 0 of N bytes".',
  bugShowsAs: ['every fetch succeeds', 'no download is left in progress'],
  async run({ devices, network, seed, converge, step, precondition, check, checkEqual, waitFor }) {
    const mac = devices.mac
    const files = await step('phone adds 25 files', () =>
      seed('phone', { count: 25, size: 256 * 1024 }),
    )
    await step('both converge', () => converge())
    await step('the network holds the Mac’s downloads', () =>
      network.hold({ op: 'download', device: 'mac' }),
    )
    const targets = files.map(() => mac.handoffTarget())
    // Each fetch resolves when its download settles, so none is awaited until
    // the network lets the downloads through.
    const returned = new Set<string>()
    const settled = Promise.allSettled(
      files.map((f, i) =>
        mac.call('provider.fetch', f.id, targets[i]).finally(() => returned.add(f.id)),
      ),
    )
    // A fetch that fails before it queues a download is never listed, so an
    // open counts as reaching the queue once it is listed or has returned.
    await precondition('every open reaches the download queue while both slots are held', () =>
      waitFor('all 25 opens to be queued or returned', async () => {
        const [hold] = await network.holds()
        const { downloads } = await mac.call<{ downloads: Record<string, unknown> }>(
          'downloads.getState',
        )
        const reached = files.filter((f) => f.id in downloads || returned.has(f.id))
        return (hold?.waiting ?? 0) >= 2 && reached.length === files.length
      }),
    )
    await step('the network lets the downloads through', () => network.releaseHolds())
    const results = await step('all 25 opens return', () => settled)
    const failed = results.filter((r) => r.status === 'rejected')
    check(
      'every fetch succeeds',
      failed.length === 0,
      failed.map((r) => (r as PromiseRejectedResult).reason?.message).join('; '),
    )
    const wrong = files.filter(
      (f, i) =>
        results[i].status === 'fulfilled' &&
        sha256(readFileSync(targets[i])) !== sha256(readFileSync(f.path)),
    )
    checkEqual(
      'every opened file has the bytes the phone added',
      wrong.map((f) => f.name),
      [],
    )
    const stuck = await waitFor(
      'downloads to settle',
      async () => {
        const state = await mac.call<{ downloads: Record<string, { status: string }> }>(
          'downloads.getState',
        )
        const active = Object.entries(state.downloads).filter(
          ([, d]) => d.status === 'queued' || d.status === 'downloading',
        )
        return active.length === 0 ? [] : undefined
      },
      { timeoutMs: 30_000 },
    ).catch(async () =>
      Object.entries(
        (await mac.call<{ downloads: Record<string, { status: string }> }>('downloads.getState'))
          .downloads,
      )
        .filter(([, d]) => d.status === 'queued' || d.status === 'downloading')
        .map(([id]) => id),
    )
    checkEqual('no download is left in progress', stuck, [])
  },
})
