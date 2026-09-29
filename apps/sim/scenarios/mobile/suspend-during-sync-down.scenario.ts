import { defineScenario } from '../../src/scenario'
import { suspendAndCheckLocks, suspensionErrors } from './phone'

export default defineScenario({
  name: 'a phone suspended while it syncs down 400 files holds no database lock on iOS and finishes the sync',
  description:
    'Every network call is slowed by 150 ms, so the laptop publishes its 400 files over time rather than at once. Once the phone has synced some of them, the network holds its next request for events, and the phone goes to the background with that request open. Suspended on iOS, it holds no hazardous lock. The request is then released, and back in the foreground the phone finishes and both devices agree.',
  devices: { phone: 'phone', laptop: 'cli' },
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
    const { phone, laptop } = devices
    await network.setConditions({ latencyMs: 150 })
    // The files the laptop has and the phone does not, split by whether their
    // events sit before or after the cursor the phone saved. The stream orders
    // events by (position, id), and the cursor names the last event the phone
    // recorded as applied.
    const missingOnPhone = async () => {
      const onPhone = new Set((await phone.library()).map((f) => f.id))
      const missing = (await laptop.library()).filter((f) => !onPhone.has(f.id))
      const cursor = await phone.call<{ id: string; after: string } | null>(
        'sync.getSyncDownCursor',
      )
      const objectOf = new Map(
        (await laptop.sql<{ fileId: string; id: string }>('SELECT fileId, id FROM objects')).map(
          (o) => [o.fileId, o.id],
        ),
      )
      const positionOf = new Map((await network.events()).map((e) => [e.id, e.position]))
      const before = (fileId: string) => {
        const id = objectOf.get(fileId)
        const position = id === undefined ? undefined : positionOf.get(id)
        if (!cursor || id === undefined || position == null) return false
        const at = new Date(cursor.after).getTime()
        return position < at || (position === at && id <= cursor.id)
      }
      const names = (files: typeof missing) => files.map((f) => f.name).sort()
      return {
        beforeItsSyncPosition: names(missing.filter((f) => before(f.id))),
        afterIt: names(missing.filter((f) => !before(f.id))),
      }
    }
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
    // The bug keeps the devices from ever agreeing, so a timeout here is
    // recorded and the files the phone is missing are checked instead.
    const agreed = await converge(undefined, { timeoutMs: 90_000 }).then(
      () => true,
      () => false,
    )
    check('both devices agree', agreed)
    checkEqual('the phone holds every file the laptop published', await missingOnPhone(), {
      beforeItsSyncPosition: [],
      afterIt: [],
    })
    checkEqual('the phone logged no suspension error', await suspensionErrors(phone), [])
  },
})
