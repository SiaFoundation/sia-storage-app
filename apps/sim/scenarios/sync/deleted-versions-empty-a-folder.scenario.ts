import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'deleting for good a file with two versions empties its folder on another device, whose sync-down keeps running',
  description:
    "The laptop adds report.txt to docs twice, and the desk syncs both versions. The laptop deletes the file for good. The desk's sync-down takes the delete and removes docs, which nothing is left in, and a file the laptop adds afterwards still reaches the desk.",
  devices: { laptop: 'cli', desk: 'cli' },
  async run({ devices: { laptop, desk }, converge, step, check, checkEqual, waitFor, workDir }) {
    await step('the laptop adds report.txt to docs, then a second version of it', async () => {
      for (const n of [1, 2]) {
        const path = `${workDir}/v${n}/report.txt`
        await Bun.write(path, `version ${n} ${crypto.randomUUID()}`)
        await laptop.addFile(path, { dir: 'docs' })
        await converge()
      }
    })
    checkEqual(
      'the desk holds both versions',
      (await desk.library()).filter((f) => f.name === 'report.txt').length,
      2,
    )

    const [current] = await laptop.sql<{ id: string }>(
      "SELECT id FROM files WHERE name = 'report.txt' AND current = 1",
    )
    await step('the laptop deletes the file for good', () =>
      laptop.call('files.tombstoneFile', current.id),
    )
    await step('the desk removes the folder the delete left empty', () =>
      waitFor(
        'docs to be gone on the desk',
        async () =>
          (
            await desk.sql<{ n: number }>(
              "SELECT count(*) AS n FROM directories WHERE path = 'docs'",
            )
          )[0].n === 0,
        { timeoutMs: 60_000, intervalMs: 500 },
      ),
    )

    await step('the laptop adds a file after the delete', async () => {
      const path = `${workDir}/after.txt`
      await Bun.write(path, `after ${crypto.randomUUID()}`)
      await laptop.addFile(path)
      await converge()
    })
    check(
      'the desk receives it, so its sync-down is still running',
      (await desk.library()).some((f) => f.name === 'after.txt'),
    )
  },
})
