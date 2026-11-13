import { sha256 } from '../../src/integrity'
import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'Free up space in File Explorer leaves nothing of the file on the PC',
  description:
    "A file saved in the File Explorer folder uploads, and the PC's daemon then removes its cache copy, since File Explorer holds the file. Free up space is chosen for the file from File Explorer's menu. The provider removes the file's bytes and tells the daemon, which forgets the file with no copy of its own to remove, and the bytes it counts on the PC fall to 0. The file then opens again from the network with the same bytes.",
  devices: { pc: 'windows' },
  timeoutMs: 6 * 60_000,
  async run({ devices, step, precondition, check, checkEqual, waitFor }) {
    const { pc } = devices
    const bytes = crypto.getRandomValues(new Uint8Array(256 * 1024))
    await step('a file is saved in File Explorer', () => pc.explorerWrite('freed.bin', bytes))
    const cached = async () => (await pc.sql('SELECT fileId FROM fs')).length > 0
    const recorded = async () =>
      (await pc.sql<{ whole: number }>('SELECT whole FROM mount_copies'))[0]
    await precondition('the file is uploaded and only File Explorer holds it', () =>
      waitFor(
        'the upload, and the daemon to remove its cache copy',
        async () =>
          (await pc.library()).some((f) => f.name === 'freed.bin' && f.uploaded) &&
          !(await cached()) &&
          (await recorded())?.whole === 1,
        { timeoutMs: 120_000, intervalMs: 1000 },
      ),
    )
    checkEqual(
      'the PC counts the file once',
      await pc.call<number>('cache.bytesOnDevice'),
      bytes.length,
    )

    await step('Free up space is chosen for the file', () => pc.freeUpSpace('freed.bin'))
    await waitFor("the file's bytes to leave the PC", () => pc.isCloudOnly('freed.bin'), {
      timeoutMs: 30_000,
      intervalMs: 500,
    })
    await waitFor('the daemon to forget the file', async () => !(await recorded()), {
      timeoutMs: 120_000,
      intervalMs: 500,
    })
    const freed = await pc.explorerState('freed.bin')
    checkEqual(
      'File Explorer shows the file as cloud-only and in sync, and not kept on the device',
      { cloudOnly: freed.cloudOnly, pinned: freed.pinned, inSync: freed.inSync },
      { cloudOnly: true, pinned: false, inSync: true },
    )
    check('the daemon never held a second copy', !(await cached()))
    checkEqual('nothing of the file is on the PC', await pc.call<number>('cache.bytesOnDevice'), 0)

    checkEqual(
      'File Explorer opens it again with its bytes',
      sha256(await pc.explorerRead('freed.bin')),
      sha256(bytes),
    )
    await waitFor(
      'the daemon to record File Explorer holding the file, with no cache copy',
      async () => (await recorded())?.whole === 1 && !(await cached()),
      { timeoutMs: 120_000, intervalMs: 1000 },
    )
    check('File Explorer still holds the file', !(await pc.isCloudOnly('freed.bin')))
  },
})
