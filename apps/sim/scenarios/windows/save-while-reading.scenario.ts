import { fileHash, sha256 } from '../../src/integrity'
import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: "a save over a file in the PC's File Explorer folder while it is still being read ends as the file's new version",
  description:
    "The laptop adds a file, and a program on the PC opens it through the File Explorer folder while the network holds the PC's downloads, so the read is waiting for bytes. A second program saves new bytes over the same file, and the downloads are let through. Whatever the first program's read ends with, the saved bytes become the file's current version on the laptop, the PC's folder holds them, and the PC's daemon has that version recorded as held by File Explorer.",
  devices: { pc: 'windows', laptop: 'cli' },
  timeoutMs: 8 * 60_000,
  async run({ devices, network, seed, converge, step, precondition, checkEqual, note, waitFor }) {
    const { pc, laptop } = devices
    const [file] = await step('laptop adds a file', () =>
      seed('laptop', { count: 1, size: 512 * 1024 }),
    )
    await step('both converge', () => converge())
    await step('the file appears in the File Explorer folder', () =>
      waitFor('the folder to list it', async () => (await pc.explorerList()).includes(file.name), {
        timeoutMs: 60_000,
        intervalMs: 500,
      }),
    )
    await step("the network holds the PC's downloads", () =>
      network.hold({ op: 'download', device: 'pc' }),
    )
    const reading = pc.explorerRead(file.name).then(
      (bytes) => `bytes hashing to ${sha256(bytes).slice(0, 12)}`,
      (e: unknown) => `an error: ${e instanceof Error ? e.message : String(e)}`,
    )
    await precondition('the read is waiting on a download', () =>
      waitFor(
        "the PC's download to be held on the network",
        async () => (await network.holds()).some((h) => h.waiting > 0),
        { timeoutMs: 30_000, intervalMs: 250 },
      ),
    )
    const saved = crypto.getRandomValues(new Uint8Array(96 * 1024))
    const saving = pc.explorerWrite(file.name, saved)
    // Windows can hold the write until the read's fetch ends, so the save is
    // given a second and the report says which order this run took.
    const savedFirst = await Promise.race([
      saving.then(() => true),
      Bun.sleep(1000).then(() => false),
    ])
    note(
      `the save had ${savedFirst ? 'finished' : 'not finished'} when the downloads were let through`,
    )
    await step('the network lets the downloads through', () => network.releaseHolds())
    await step('the save and the read end', async () => {
      await saving
      note(`the read ended with ${await reading}`)
    })

    const current = await step('the laptop gets the saved bytes as the current version', () =>
      waitFor(
        'the new version on the laptop',
        async () =>
          (await laptop.library()).find(
            (f) =>
              f.name === file.name && f.current && f.uploaded && fileHash(f.hash) === sha256(saved),
          ),
        { timeoutMs: 120_000, intervalMs: 1000 },
      ),
    )
    await step('both converge', () => converge())
    checkEqual(
      "the PC's folder holds the saved bytes",
      sha256(await pc.explorerRead(file.name)),
      sha256(saved),
    )
    await waitFor(
      'the daemon to record the saved version as held by File Explorer',
      async () =>
        (await pc.sql<{ fileId: string }>('SELECT fileId FROM mount_copies WHERE whole = 1'))[0]
          ?.fileId === current.id,
      { timeoutMs: 60_000, intervalMs: 1000 },
    )
    checkEqual(
      'the daemon has the saved version recorded as held by File Explorer',
      await pc.sql('SELECT fileId, bytes FROM mount_copies'),
      [{ fileId: current.id, bytes: saved.length }],
    )
  },
})
