import { fileHash, sha256 } from '../../src/integrity'
import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'a file marked Always keep on this device downloads to the PC, and again when another device saves a new version',
  description:
    'The laptop adds a file, which appears in the File Explorer folder on the PC with no bytes. Always keep on this device is chosen for it from File Explorer’s menu, and its bytes arrive without anything opening it. The laptop then saves a new version, and the PC ends holding the bytes of that version, still marked to keep.',
  devices: { pc: 'windows', laptop: 'cli' },
  timeoutMs: 8 * 60_000,
  async run({ devices, seed, converge, step, precondition, check, checkEqual, waitFor }) {
    const { pc, laptop } = devices
    const [file] = await step('laptop adds a file', () =>
      seed('laptop', { count: 1, size: 96 * 1024 }),
    )
    await step('both converge', () => converge())
    await step('the file appears in the File Explorer folder', () =>
      waitFor('the folder to list it', async () => (await pc.explorerList()).includes(file.name), {
        timeoutMs: 60_000,
        intervalMs: 500,
      }),
    )
    await precondition('the file has no bytes on the PC', () => pc.isCloudOnly(file.name))
    const held = async () =>
      (await pc.sql<{ fileId: string }>('SELECT fileId FROM mount_copies WHERE whole = 1')).map(
        (r) => r.fileId,
      )

    await step('the file is kept on this device', () => pc.keepOnDevice(file.name))
    await waitFor("the file's bytes to arrive", async () => !(await pc.isCloudOnly(file.name)), {
      timeoutMs: 60_000,
      intervalMs: 500,
    })
    await waitFor('the daemon to record the file', async () => (await held()).length === 1, {
      timeoutMs: 120_000,
      intervalMs: 500,
    })
    check('the file downloaded without being opened', !(await pc.isCloudOnly(file.name)))
    checkEqual('the daemon has it recorded as held by File Explorer', await held(), [file.id])

    const newer = crypto.getRandomValues(new Uint8Array(128 * 1024))
    await step('the laptop saves a new version', () =>
      laptop.call('provider.write', file.id, laptop.stage(newer)),
    )
    await step('both converge', () => converge())
    const current = (await laptop.library()).find((f) => f.name === file.name && f.current)
    await waitFor(
      'the PC to hold the new version',
      async () => (await held()).join() === current?.id && !(await pc.isCloudOnly(file.name)),
      { timeoutMs: 120_000, intervalMs: 1000 },
    )
    checkEqual('the daemon has the new version recorded as held', await held(), [current?.id])
    check('the file is still marked to keep', (await pc.isKeptOnDevice(file.name)) === true)
    const kept = await pc.explorerState(file.name)
    checkEqual(
      'File Explorer shows the new version kept on the device and in sync',
      {
        pinned: kept.pinned,
        cloudOnly: kept.cloudOnly,
        inSync: kept.inSync,
        version: fileHash(kept.identity?.split('\n')[1] ?? ''),
      },
      { pinned: true, cloudOnly: false, inSync: true, version: sha256(newer) },
    )
    checkEqual(
      'the PC holds the bytes of the new version',
      sha256(await pc.explorerRead(file.name)),
      sha256(newer),
    )
  },
})
