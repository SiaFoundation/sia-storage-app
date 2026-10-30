import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'a deleted folder leaves every device, and restoring it puts its files back where they were on both',
  description:
    "The laptop adds a.txt and b.txt to Trips and c.txt to Trips/sub, then trashes a.txt and deletes Trips. Neither device keeps Trips, though a.txt was already in the trash, and the desk's trash lists Trips as one item beside a.txt. The desk restores Trips, and both devices get b.txt back in Trips and c.txt in Trips/sub, with a.txt still in the trash.",
  devices: { laptop: 'cli', desk: 'cli' },
  async run({ devices: { laptop, desk }, converge, step, check, checkEqual, workDir }) {
    await step('the laptop adds a.txt and b.txt to Trips and c.txt to Trips/sub', async () => {
      for (const [name, dir] of [
        ['a.txt', 'Trips'],
        ['b.txt', 'Trips'],
        ['c.txt', 'Trips/sub'],
      ]) {
        const path = `${workDir}/${name}`
        await Bun.write(path, `${name} ${crypto.randomUUID()}`)
        await laptop.addFile(path, { dir })
      }
      await converge()
    })

    const idOf = async (name: string) =>
      (
        await laptop.sql<{ id: string }>(
          "SELECT id FROM files WHERE name = ? AND kind = 'file'",
          name,
        )
      )[0].id
    const folders = async (device: typeof laptop) =>
      (await device.sql<{ path: string }>('SELECT path FROM directories ORDER BY path')).map(
        (r) => r.path,
      )
    const placed = (device: typeof laptop) =>
      device.sql<{ name: string; folder: string | null; trashed: number }>(
        `SELECT f.name, d.path AS folder, f.trashedAt IS NOT NULL AS trashed
           FROM files f LEFT JOIN directories d ON d.id = f.directoryId
          WHERE f.kind = 'file' ORDER BY f.name`,
      )

    await step('the laptop trashes a.txt', async () => {
      await laptop.call('files.trashFile', await idOf('a.txt'))
      await converge()
    })

    await step('the laptop deletes Trips', async () => {
      const [trips] = await laptop.sql<{ id: string }>(
        "SELECT id FROM directories WHERE path = 'Trips'",
      )
      await laptop.call('directories.deleteAndTrashFiles', trips.id)
      await converge()
    })
    checkEqual('the laptop has no folders after the delete', await folders(laptop), [])
    checkEqual('the desk has no folders after the delete', await folders(desk), [])

    const entries =
      await desk.call<
        { id: string; kind: string; name: string; folder: string | null; files: number }[]
      >('files.trashEntries')
    checkEqual(
      "the desk's trash lists Trips as one item beside a.txt",
      entries.map((e) => [e.kind, e.name, e.folder, e.files]).sort(),
      [
        ['file', 'a.txt', 'Trips', 1],
        ['folder', 'Trips', null, 2],
      ],
    )

    await step('the desk restores Trips', async () => {
      const trips = entries.find((e) => e.kind === 'folder')
      if (!trips) throw new Error('No folder entry in the trash')
      await desk.call('files.restoreTrashEntries', [trips.id])
      await converge()
    })
    const expected = [
      { name: 'a.txt', folder: null, trashed: 1 },
      { name: 'b.txt', folder: 'Trips', trashed: 0 },
      { name: 'c.txt', folder: 'Trips/sub', trashed: 0 },
    ]
    checkEqual('the desk has b.txt and c.txt back where they were', await placed(desk), expected)
    checkEqual(
      'the laptop has b.txt and c.txt back where they were',
      await placed(laptop),
      expected,
    )
    check(
      'both devices have Trips and Trips/sub again',
      JSON.stringify(await folders(laptop)) === '["Trips","Trips/sub"]' &&
        JSON.stringify(await folders(desk)) === '["Trips","Trips/sub"]',
    )
  },
})
