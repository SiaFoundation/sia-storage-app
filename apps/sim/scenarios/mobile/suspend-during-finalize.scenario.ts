import { pinnedTwice } from '../../src/integrity'
import { defineScenario } from '../../src/scenario'
import { suspendAndCheckLocks } from './phone'

export default defineScenario({
  name: 'a phone suspended while it saves a finished upload leaves no object on the network without a file',
  description:
    'The network holds the phone’s pins unanswered. Once an upload from the phone has reached the network and a pin is waiting, the phone goes to the background in the middle of pinning the objects and recording them. The pins are then released. Afterwards every pinned object belongs to a file on the phone, no import row is left in progress, and both devices agree.',
  devices: { phone: 'phone', laptop: 'cli' },
  intermittentBug:
    'The uploader can queue a file that a database poll is about to return as well, so the file is added to the batch twice, uploaded twice and pinned twice.',
  bugShowsAs: [
    { check: 'one pinned object per file', matches: (pins: number) => pins > 6 },
    { check: 'no file’s bytes are pinned twice', matches: (hashes: string[]) => hashes.length > 0 },
  ],
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
    checkContent,
  }) {
    const phone = devices.phone
    await network.hold({ op: 'pin', device: 'phone' })
    const files = await step('phone imports 6 files', () =>
      seed('phone', { count: 6, size: 64 * 1024 }),
    )
    const pinWaiting = async () => (await network.holds()).some((h) => h.waiting > 0)
    await precondition('a pin from the phone is waiting on the network', () =>
      waitFor('a held pin from the phone', pinWaiting, { intervalMs: 50 }),
    )
    await suspendAndCheckLocks(phone, { step, check, note, precondition }, undefined, {
      name: 'the pin is still waiting once the phone is in the background',
      holds: pinWaiting,
    })
    await network.releaseHolds()
    await step('bring the phone back', () => phone.foreground())
    await step('both converge', () => converge(undefined, { timeoutMs: 180_000 }))

    const recorded = new Set(
      (await phone.sql<{ id: string }>('SELECT id FROM objects')).map((r) => r.id),
    )
    const orphans = (await network.objects()).filter((o) => !recorded.has(o.id)).map((o) => o.id)
    checkEqual('every pinned object belongs to a file on the phone', orphans, [])
    checkEqual('one pinned object per file', (await network.objects()).length, files.length)
    checkEqual('no file’s bytes are pinned twice', await pinnedTwice(network), [])
    const [inProgress] = await phone.sql<{ n: number }>(
      `SELECT count(*) AS n FROM import_files WHERE state IN ('pending', 'active')`,
    )
    checkEqual('no import row is left in progress', inProgress.n, 0)
    await checkContent()
  },
})
