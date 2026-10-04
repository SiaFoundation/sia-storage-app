import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'trashing a folder that holds two versions of a file succeeds, and the other device keeps syncing',
  description:
    "The laptop adds report.txt to docs twice, so docs holds two versions of it, and the desk syncs both. Trashing docs on the laptop succeeds and trashes both versions, the desk takes the trash, and a file the laptop adds afterwards still reaches the desk, so the desk's sync-down did not stop.",
  devices: { laptop: 'cli', desk: 'cli' },
  knownBug:
    'Deleting a folder is not sent to other devices. The laptop trashes the files, which syncs, then deletes docs, which leaves its trashed versions in no folder while the desk still has them in docs.',
  bugShowsAs: ['every device holds the same library at the end'],
  async run({ devices: { laptop, desk }, converge, step, check, checkEqual, waitFor, workDir }) {
    await step('the laptop adds report.txt to docs, then a second version of it', async () => {
      for (const n of [1, 2]) {
        const path = `${workDir}/v${n}/report.txt`
        await Bun.write(path, `version ${n} ${crypto.randomUUID()}`)
        await laptop.addFile(path, { dir: 'docs' })
        await converge()
      }
    })
    const versionsOn = async (device: typeof desk) =>
      (await device.library()).filter((f) => f.name === 'report.txt')
    checkEqual('the desk holds both versions', (await versionsOn(desk)).length, 2)

    const [docs] = await laptop.sql<{ id: string }>(
      "SELECT id FROM directories WHERE path = 'docs'",
    )
    let trashFailure: string | null = null
    await step('the laptop trashes docs', async () => {
      try {
        await laptop.call('directories.deleteAndTrashFiles', docs.id)
      } catch (e) {
        trashFailure = e instanceof Error ? e.message : String(e)
      }
    })
    checkEqual('trashing the folder succeeds', trashFailure, null)
    const laptopVersions = await versionsOn(laptop)
    check(
      'both versions are trashed on the laptop',
      laptopVersions.length === 2 && laptopVersions.every((f) => f.trashed),
    )

    // Waited for directly rather than through converge: the devices still
    // disagree on which folder the trashed versions are in, because a folder
    // delete does not reach other devices.
    await step('the laptop adds a file after the trash, and the desk receives it', async () => {
      const path = `${workDir}/after.txt`
      await Bun.write(path, `after ${crypto.randomUUID()}`)
      await laptop.addFile(path)
      await waitFor(
        'after.txt on the desk',
        async () => (await desk.library()).some((f) => f.name === 'after.txt'),
        { timeoutMs: 60_000, intervalMs: 500 },
      )
    })
    check(
      'the desk receives it, so its sync-down is still running',
      (await desk.library()).some((f) => f.name === 'after.txt'),
    )
    const deskVersions = await versionsOn(desk)
    check(
      'the desk has both versions trashed',
      deskVersions.length === 2 && deskVersions.every((f) => f.trashed),
    )
  },
})
