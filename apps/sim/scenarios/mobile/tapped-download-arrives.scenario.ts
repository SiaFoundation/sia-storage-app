import { defineScenario } from '../../src/scenario'

const LATER = 21

export default defineScenario({
  name: 'a file the user taps to download arrives even when it was already queued in the background',
  description:
    'The phone has one download slot, held busy on the network. It queues a file in the background, then the user taps the same file, then 21 more background downloads queue behind it. Once the network lets go, the tapped file is on the phone.',
  devices: { phone: 'phone', laptop: 'cli' },
  knownBug: {
    ios: 'A tap on a file already queued in the background joins that download at background priority, whose queue drops its oldest waiter past 20, and a dropped download resolves as if it had finished, so the tap succeeds with nothing downloaded.',
  },
  intermittentBug: {
    android:
      'A tap on a file already queued in the background joins that download at background priority, whose queue drops its oldest waiter past 20, and a dropped download resolves as if it had finished, so the tap succeeds with nothing downloaded.',
  },
  bugShowsAs: [
    {
      check: 'the tapped download is still waiting when the network lets the downloads through',
      got: { settled: true },
    },
    'the tapped file is on the phone',
    {
      check: 'phone has no download left queued or downloading',
      matches: (ids: string[]) => ids.length > 0,
    },
  ],
  timeoutMs: 6 * 60_000,
  async run({
    devices: { phone },
    network,
    seed,
    converge,
    step,
    precondition,
    check,
    checkEqual,
    waitFor,
  }) {
    const files = await step('laptop adds files for the phone to download', () =>
      seed('laptop', { count: LATER + 2, size: 64 * 1024 }),
    )
    await step('both converge', () => converge())
    const [blocker, target, ...later] = files
    await step('phone gets one download slot, and the network holds its downloads', async () => {
      await phone.call('downloads.setMaxSlots', 1)
      await network.hold({ op: 'download', device: 'phone' })
    })
    // Each returns once the app has registered the download, or joined it to
    // the one already running for that file, so they reach the app in order.
    const start = (fileId: string, priority?: number) =>
      priority === undefined
        ? phone.call<number>('sim.startDownload', fileId)
        : phone.call<number>('sim.startDownload', fileId, priority)
    await start(blocker.id, 0)
    await precondition('the blocker takes the slot', () =>
      waitFor('the blocker to be held on the network', async () => {
        const [hold] = await network.holds()
        return (hold?.waiting ?? 0) > 0
      }),
    )
    const tap = await step('the file is queued in the background, then tapped', async () => {
      await start(target.id)
      return start(target.id, 0)
    })
    await step(`${LATER} more downloads queue in the background`, async () => {
      for (const f of later) await start(f.id)
    })
    // The background queue keeps 20 and drops the oldest once each later
    // download reaches it, a few database reads after it registers. A dropped
    // download ends at once, so one still queued is still waiting after 10s.
    const outcome = () =>
      phone.call<{ settled: boolean; error?: string }>('sim.downloadOutcome', tap)
    const tapped = await waitFor(
      'the tapped download to end',
      async () => {
        const o = await outcome()
        return o.settled ? o : undefined
      },
      { timeoutMs: 10_000, intervalMs: 250 },
    ).catch(outcome)
    checkEqual(
      'the tapped download is still waiting when the network lets the downloads through',
      tapped,
      { settled: false },
    )
    await step('the network lets the downloads through', () => network.releaseHolds())
    const onPhone = async () =>
      (
        await phone.sql<{ n: number }>('SELECT count(*) AS n FROM fs WHERE fileId = ?1', target.id)
      )[0]?.n === 1
    const arrived = await waitFor(
      'the tapped file on the phone',
      async () => ((await onPhone()) ? true : undefined),
      { timeoutMs: 30_000, intervalMs: 1000 },
    ).catch(() => false)
    check('the tapped file is on the phone', arrived === true)
  },
})
