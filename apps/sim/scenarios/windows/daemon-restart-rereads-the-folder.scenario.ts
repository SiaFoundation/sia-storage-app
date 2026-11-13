import { fileHash, sha256 } from '../../src/integrity'
import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: "the PC's File Explorer folder carries on after its daemon is killed and started again",
  description:
    "Two files saved in the File Explorer folder upload, and the PC's daemon has both recorded as held by File Explorer. The daemon is killed, and Free up space removes one file's bytes while the app is starting another. The provider connects to the new daemon, which ends with only the file File Explorer still holds recorded, whether the provider's report of the freed file reached it or it read the folder's files after connecting. A file saved in the folder afterwards uploads, and the freed file opens again with its bytes.",
  devices: { pc: 'windows' },
  timeoutMs: 8 * 60_000,
  async run({ devices, step, precondition, checkEqual, waitFor }) {
    const { pc } = devices
    const kept = crypto.getRandomValues(new Uint8Array(64 * 1024))
    const freed = crypto.getRandomValues(new Uint8Array(64 * 1024))
    await step('two files are saved in File Explorer', async () => {
      await pc.explorerWrite('kept.bin', kept)
      await pc.explorerWrite('freed.bin', freed)
    })
    const recorded = async () =>
      (
        await pc.sql<{ name: string }>(
          'SELECT f.name AS name FROM mount_copies m JOIN files f ON f.id = m.fileId WHERE m.whole = 1 ORDER BY f.name',
        )
      ).map((r) => r.name)
    await precondition('both are uploaded and recorded as held by File Explorer', () =>
      waitFor(
        'two uploads, two records and no cache copy',
        async () =>
          (await pc.library()).filter((f) => f.uploaded).length === 2 &&
          (await recorded()).length === 2 &&
          (await pc.sql('SELECT fileId FROM fs')).length === 0,
        { timeoutMs: 120_000, intervalMs: 1000 },
      ),
    )

    await step('the daemon is killed', () => pc.killDaemon())
    await step('Free up space is chosen for one file', async () => {
      await pc.freeUpSpace('freed.bin')
      await waitFor("the file's bytes to leave the PC", () => pc.isCloudOnly('freed.bin'), {
        timeoutMs: 30_000,
        intervalMs: 500,
      })
    })
    await step('the app starts the daemon again', () =>
      waitFor('the daemon to answer', () => pc.isRunning(), {
        timeoutMs: 60_000,
        intervalMs: 1000,
      }),
    )
    await waitFor(
      'the daemon to forget the freed file',
      async () => (await recorded()).join() === 'kept.bin',
      { timeoutMs: 90_000, intervalMs: 1000 },
    )
    checkEqual(
      'the daemon has only the file File Explorer still holds recorded',
      await recorded(),
      ['kept.bin'],
    )
    checkEqual(
      'the PC counts only that file',
      await pc.call<number>('cache.bytesOnDevice'),
      kept.length,
    )

    const later = crypto.getRandomValues(new Uint8Array(32 * 1024))
    await step('a file is saved in File Explorer after the restart', () =>
      pc.explorerWrite('later.bin', later),
    )
    const uploaded = await waitFor(
      'the new file to upload',
      async () => (await pc.library()).find((f) => f.name === 'later.bin' && f.uploaded),
      { timeoutMs: 120_000, intervalMs: 1000 },
    )
    checkEqual(
      'a file saved after the restart uploaded with its bytes',
      fileHash(uploaded.hash),
      sha256(later),
    )
    checkEqual(
      'the freed file opens again with its bytes',
      sha256(await pc.explorerRead('freed.bin')),
      sha256(freed),
    )
  },
})
