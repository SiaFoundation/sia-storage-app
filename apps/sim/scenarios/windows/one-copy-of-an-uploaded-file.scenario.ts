import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'the PC keeps one copy of an uploaded file File Explorer holds',
  description:
    "A file saved into the File Explorer folder is copied into the PC's daemon's cache to upload from, so until it uploads the PC holds it twice and counts it once. Once it has uploaded, the daemon removes its cache copy, since File Explorer holds the file, and the PC still counts it once.",
  devices: { pc: 'windows' },
  timeoutMs: 6 * 60_000,
  async run({ devices, network, step, precondition, check, checkEqual, waitFor }) {
    const { pc } = devices
    const bytes = crypto.getRandomValues(new Uint8Array(256 * 1024))
    const cached = async () => (await pc.sql('SELECT fileId FROM fs')).length
    const recorded = async () =>
      (await pc.sql<{ bytes: number; whole: number }>('SELECT bytes, whole FROM mount_copies'))[0]

    await step('the PC goes offline', () => network.setOffline('pc', true))
    await step('a file is saved in File Explorer', () => pc.explorerWrite('kept-once.bin', bytes))
    await precondition('the daemon has the file in its cache, waiting to upload', () =>
      waitFor(
        'a cache copy and no upload',
        async () => (await cached()) === 1 && (await pc.library()).every((f) => !f.uploaded),
        { timeoutMs: 60_000, intervalMs: 500 },
      ),
    )
    checkEqual('the daemon has the file recorded as held by File Explorer', await recorded(), {
      bytes: bytes.length,
      whole: 1,
    })
    checkEqual(
      'the PC counts a file waiting to upload once',
      await pc.call<number>('cache.bytesOnDevice'),
      bytes.length,
    )

    await step('the PC comes back online', () => network.setOffline('pc', false))
    await step('the file uploads', () =>
      waitFor('the upload', async () => (await pc.library()).every((f) => f.uploaded), {
        timeoutMs: 120_000,
        intervalMs: 1000,
      }),
    )
    await waitFor('the daemon to remove its cache copy', async () => (await cached()) === 0, {
      timeoutMs: 30_000,
      intervalMs: 500,
    })
    check('File Explorer still holds the file', !(await pc.isCloudOnly('kept-once.bin')))
    checkEqual(
      'the PC counts the uploaded file once',
      await pc.call<number>('cache.bytesOnDevice'),
      bytes.length,
    )
  },
})
