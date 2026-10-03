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
  bugShowsAs: ['the tapped file is on the phone'],
  timeoutMs: 6 * 60_000,
  async run({ devices: { phone }, network, seed, converge, step, precondition, check, waitFor }) {
    const files = await step('laptop adds files for the phone to download', () =>
      seed('laptop', { count: LATER + 2, size: 64 * 1024 }),
    )
    await step('both converge', () => converge())
    const [blocker, target, ...later] = files
    await step('phone gets one download slot, and the network holds its downloads', async () => {
      await phone.call('downloads.setMaxSlots', 1)
      await network.hold({ op: 'download', device: 'phone' })
    })
    // Each call resolves when its download settles, so none is awaited here.
    const pending: Promise<unknown>[] = []
    pending.push(phone.call('downloads.downloadFile', blocker.id, 0))
    await precondition('the blocker takes the slot', () =>
      waitFor('the blocker to be held on the network', async () => {
        const [hold] = await network.holds()
        return (hold?.waiting ?? 0) > 0
      }),
    )
    pending.push(phone.call('downloads.downloadFile', target.id))
    await Bun.sleep(200)
    pending.push(phone.call('downloads.downloadFile', target.id, 0))
    await Bun.sleep(200)
    for (const f of later) pending.push(phone.call('downloads.downloadFile', f.id))
    // The queue drops past 20 as the later ones arrive, so once all 21 are
    // queued any eviction has happened, whichever file it took.
    await precondition(`all ${LATER} later downloads are queued behind the blocker`, () =>
      waitFor(`${LATER} downloads to queue`, async () => {
        const { downloads } = await phone.call<{ downloads: Record<string, unknown> }>(
          'downloads.getState',
        )
        return later.every((f) => f.id in downloads)
      }),
    )
    await step('the network lets the downloads through', () => network.releaseHolds())
    await Promise.allSettled(pending)
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
