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
  bugShowsAs: [
    {
      check: 'every fetch succeeds',
      // Only opens whose download the queue dropped, which then find no bytes.
      matches: (errors: string[]) =>
        errors.length > 0 && errors.every((e) => /Local copy is 0 of \d+ bytes/.test(e)),
    },
    { check: 'no download is left in progress', matches: (ids: string[]) => ids.length > 0 },
    {
      check: 'mac has no download left queued or downloading',
      matches: (ids: string[]) => ids.length > 0,
    },
  ],
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
    const settled = Promise.allSettled(
      files.map((f, i) => mac.call('provider.fetch', f.id, targets[i])),
    )
    // An open registers its download before waiting for one of the two slots,
    // and a download the queue drops keeps its entry, so all 25 listed means
    // every open reached the queue. One that failed before it would be missing.
    await precondition('every open reaches the download queue while both slots are held', () =>
      waitFor('all 25 opens to be queued', async () => {
        const [hold] = await network.holds()
        const { downloads } = await mac.call<{ downloads: Record<string, unknown> }>(
          'downloads.getState',
        )
        return (hold?.waiting ?? 0) >= 2 && files.every((f) => f.id in downloads)
      }),
    )
    await step('the network lets the downloads through', () => network.releaseHolds())
    const results = await step('all 25 opens return', () => settled)
    const failed = results.filter((r) => r.status === 'rejected')
    checkEqual(
      'every fetch succeeds',
      failed.map((r) => String((r as PromiseRejectedResult).reason?.message)),
      [],
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
