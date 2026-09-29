import { defineScenario } from '../../src/scenario'
import { seedFiles } from '../../src/seed'

export default defineScenario({
  name: 'an import whose last writes a suspension cuts off finishes after resume without using a retry',
  description:
    'The phone imports one file, and sim holds the copy until the suspension has closed the database gate, so the import’s next write lands on a closed gate. Back in the foreground the import finishes, with none of its retries used. Android closes no gate for a suspension, so there the copy is released once the phone is back, and the import still has to finish without a retry.',
  devices: { phone: 'phone' },
  knownBug: {
    ios: 'A write made while the database gate is closed for a suspension fails at once, and the import scanner leaves the row claimed as a suspended one, so the file sits unimported until its claim is freed ten minutes later.',
  },
  intermittentBug: {
    android:
      'The uploader can queue a file that a database poll is about to return as well, so the file is added to the batch twice, uploaded twice and pinned twice.',
  },
  bugShowsAs: {
    ios: [
      { check: 'the file is added', got: 'active' },
      { check: 'phone has no import left in progress', got: { active: 1 } },
    ],
    android: [
      {
        check: 'no file’s bytes are pinned twice',
        matches: (hashes: string[]) => hashes.length > 0,
      },
    ],
  },
  timeoutMs: 6 * 60_000,
  async run({ devices: { phone }, step, precondition, checkEqual, waitFor, workDir }) {
    const [path] = seedFiles(workDir, { prefix: 'cut', count: 1, size: 4 * 1024 * 1024 })
    await step('hold import copies until a suspension closes the database gate', () =>
      phone.call('sim.holdImportCopiesUntilSuspend'),
    )
    const importId = await step('phone starts importing the file', () => phone.importFiles([path]))
    const row = async () =>
      (
        await phone.sql<{ state: string; attempts: number }>(
          'SELECT state, attempts FROM import_files WHERE importId = ?1',
          importId,
        )
      )[0]
    await precondition('the copy is held before the phone goes to the background', () =>
      waitFor(
        'the import row to be claimed',
        async () => (await row())?.state === 'active' || undefined,
      ),
    )
    await step('the phone goes to the background', () => phone.background!())
    await Bun.sleep(5000)
    const stillHeld = await step('bring the phone back and release any hold left', async () => {
      await phone.foreground!()
      return phone.call<boolean>('sim.releaseImportCopies')
    })
    if (phone.kind === 'ios') {
      await precondition('the suspension released the held copy', async () => {
        if (stillHeld) throw new Error('the copy was still held when the phone came back')
      })
    }
    await waitFor(
      'the file to be added',
      async () => (await row())?.state === 'added' || undefined,
      {
        timeoutMs: 90_000,
        intervalMs: 1000,
      },
    ).catch(() => {})
    const end = await row()
    checkEqual('the import used none of its retries', end?.attempts, 0)
    checkEqual('the file is added', end?.state, 'added')
  },
})
