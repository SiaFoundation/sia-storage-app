import { defineScenario } from '../../src/scenario'
import { seedFiles } from '../../src/seed'
import { suspendAndCheckLocks } from './phone'

const FILES = 300

export default defineScenario({
  name: 'an import suspended five times, the first while it copies, finishes soon after the last resume',
  description:
    'The phone starts importing 300 files of 128 KB and goes to the background five times while it works through them. Within two minutes of the last return to the foreground, every file is added.',
  devices: { phone: 'phone' },
  knownBug: {
    ios: 'A suspension cuts off the import tick after it has claimed rows it has not started, and the next tick frees a claim only once it is ten minutes old, so those files sit unimported until then.',
  },
  intermittentBug: {
    android:
      'A suspension can cut off the import tick after it has claimed rows it has not started, and the next tick frees a claim only once it is ten minutes old, so those files sit unimported until then.',
  },
  bugShowsAs: ['all 300 files are added within two minutes'],
  timeoutMs: 10 * 60_000,
  async run({ devices: { phone }, step, precondition, check, note, checkEqual, waitFor, workDir }) {
    const paths = seedFiles(workDir, { prefix: 'burst', count: FILES, size: 128 * 1024 })
    const importId = await step(`start importing ${FILES} files`, () => phone.importFiles(paths))
    const inStates = async (states: string) => {
      const [row] = await phone.sql<{ n: number }>(
        `SELECT count(*) AS n FROM import_files WHERE importId = ?1 AND state IN (${states})`,
        importId,
      )
      return row?.n ?? 0
    }
    await precondition('the import is copying before the first suspension', () =>
      waitFor('a row of the import to be copying', async () => (await inStates("'active'")) > 0),
    )
    for (let i = 1; i <= 5; i++) {
      if (i > 1) await Bun.sleep(700)
      await suspendAndCheckLocks(
        phone,
        { step, check, note, precondition },
        `suspension ${i}`,
        i === 1
          ? {
              name: 'the import is still running at the first suspension',
              holds: async () => (await inStates("'pending', 'active'")) > 0,
            }
          : undefined,
      )
      await step(`bring the phone back (${i})`, () => phone.foreground())
    }
    // Every file is unique, so a row marked duplicate is a failure.
    const added = () => inStates("'added'")
    const done = await waitFor(
      `all ${FILES} files to be added`,
      async () => ((await added()) >= FILES ? true : undefined),
      { timeoutMs: 120_000, intervalMs: 2000 },
    ).catch(() => false)
    checkEqual(
      `all ${FILES} files are added within two minutes`,
      done ? FILES : await added(),
      FILES,
    )
  },
})
