import { fileHash, sha256 } from '../../src/integrity'
import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: "another device's new version of a file takes the place of the PC's copy in File Explorer",
  description:
    'The laptop adds two files, and the PC opens one of them in its File Explorer folder, so the PC holds one and not the other. The laptop then saves a new version of each. On the PC the file that was held loses its bytes, which the daemon stops counting, and both files then open through the folder with the bytes of their new versions.',
  devices: { pc: 'windows', laptop: 'cli' },
  timeoutMs: 8 * 60_000,
  async run({ devices, seed, converge, step, precondition, checkEqual, waitFor }) {
    const { pc, laptop } = devices
    const [held, unopened] = await step('laptop adds 2 files', () =>
      seed('laptop', { count: 2, size: 64 * 1024 }),
    )
    await step('both converge', () => converge())
    await step('the files appear in the File Explorer folder', () =>
      waitFor('the folder to list them', async () => (await pc.explorerList()).length === 2, {
        timeoutMs: 60_000,
        intervalMs: 500,
      }),
    )
    await step('the PC opens one of them', () => pc.explorerRead(held.name))
    const counted = () => pc.call<number>('cache.bytesOnDevice')
    await precondition('the PC holds that file and counts it', () =>
      waitFor('the daemon to record the file', async () => (await counted()) === 64 * 1024, {
        timeoutMs: 120_000,
        intervalMs: 500,
      }),
    )

    const newer = new Map(
      [held, unopened].map((f) => [f, crypto.getRandomValues(new Uint8Array(80 * 1024))]),
    )
    await step('the laptop saves a new version of each', async () => {
      for (const [file, bytes] of newer) {
        await laptop.call('provider.write', file.id, laptop.stage(bytes))
      }
    })
    await step('both converge', () => converge())
    await waitFor("the held file's old bytes to leave the PC", () => pc.isCloudOnly(held.name), {
      timeoutMs: 60_000,
      intervalMs: 500,
    })
    await waitFor('the daemon to stop counting them', async () => (await counted()) === 0, {
      timeoutMs: 120_000,
      intervalMs: 500,
    })
    checkEqual('the PC counts nothing of the old version', await counted(), 0)
    const replaced = await pc.explorerState(held.name)
    checkEqual(
      'File Explorer shows the held file as cloud-only and in sync at the new version',
      {
        cloudOnly: replaced.cloudOnly,
        inSync: replaced.inSync,
        version: fileHash(replaced.identity?.split('\n')[1] ?? ''),
      },
      { cloudOnly: true, inSync: true, version: sha256(newer.get(held) as Uint8Array) },
    )
    const wrong = []
    for (const [file, bytes] of newer) {
      if (sha256(await pc.explorerRead(file.name)) !== sha256(bytes)) wrong.push(file.name)
    }
    checkEqual('both files open on the PC with the bytes of their new versions', wrong, [])
  },
})
