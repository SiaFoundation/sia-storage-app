import { defineScenario } from '../../src/scenario'
import { suspendAndCheckLocks, suspensionErrors } from './phone'

export default defineScenario({
  name: 'a phone suspended while it syncs down 400 files holds no database lock on iOS and finishes the sync',
  description:
    'Every network call is slowed by 150 ms, so the laptop publishes its 400 files over time rather than at once. Once the phone has synced some of them, the network holds its next request for events, and the phone goes to the background with that request open. Suspended on iOS, it holds no hazardous lock. The request is then released, and back in the foreground the phone finishes and both devices agree.',
  devices: { phone: 'phone', laptop: 'cli' },
  knownBug: {
    ios: "Suspending the app aborts a running sync-down while it applies a batch, and the loop saves the batch's last event as the cursor anyway, so the next run starts after events that were never applied and those files never appear on the phone.",
  },
  bugShowsAs: ['waiting for devices to converge', 'both hold all 400'],
  timeoutMs: 8 * 60_000,
  async run({
    devices,
    network,
    seed,
    converge,
    step,
    precondition,
    waitFor,
    check,
    note,
    checkEqual,
  }) {
    const phone = devices.phone
    await network.setConditions({ latencyMs: 150 })
    await step('laptop adds 400 files', () => seed('laptop', { count: 400, size: 4096 }))
    const synced = async () => {
      const [row] = await phone.sql<{ n: number }>(
        `SELECT count(*) AS n FROM files WHERE kind = 'file'`,
      )
      return row.n
    }
    await precondition('the phone has synced some but not all of them', () =>
      waitFor('the phone to sync some files', async () => {
        const n = await synced()
        return n > 20 && n < 400
      }),
    )
    await network.hold({ op: 'events', device: 'phone' })
    const eventsWaiting = async () => (await network.holds()).some((h) => h.waiting > 0)
    await precondition('a request for events from the phone is waiting on the network', () =>
      waitFor('a held events request from the phone', eventsWaiting, { intervalMs: 50 }),
    )
    await precondition('the phone has still not synced all 400', async () => (await synced()) < 400)
    await suspendAndCheckLocks(phone, { step, check, note, precondition }, undefined, {
      name: 'the request for events is still open once the phone is in the background',
      holds: eventsWaiting,
    })
    await network.releaseHolds()
    await network.setConditions({ latencyMs: 0 })
    await step('bring the phone back', () => phone.foreground())
    const { files } = await step('both converge', () => converge(undefined, { timeoutMs: 90_000 }))
    checkEqual('both hold all 400', files, 400)
    checkEqual('the phone logged no suspension error', await suspensionErrors(phone), [])
  },
})
