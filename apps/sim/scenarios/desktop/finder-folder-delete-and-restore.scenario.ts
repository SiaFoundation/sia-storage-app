import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'a folder deleted in Finder leaves both devices, comes back in Finder when restored, and still takes a file after its last one is deleted',
  description:
    "The laptop adds a.txt and b.txt to Docs. The Mac deletes Docs in its Finder folder, and neither device keeps Docs. The laptop restores what the delete put in the trash, and Docs comes back in the Mac's Finder folder with both files. The Mac then deletes both files in Finder and writes c.txt into Docs, which reaches the laptop in Docs.",
  devices: { mac: 'desktop', laptop: 'cli' },
  timeoutMs: 10 * 60_000,
  async run({ devices: { mac, laptop }, converge, step, check, checkEqual, waitFor, workDir }) {
    await step('the laptop adds a.txt and b.txt to Docs', async () => {
      for (const name of ['a.txt', 'b.txt']) {
        const path = `${workDir}/${name}`
        await Bun.write(path, `${name} ${crypto.randomUUID()}`)
        await laptop.addFile(path, { dir: 'Docs' })
      }
      await converge()
    })
    await step('Docs appears in the Finder folder with both files', () =>
      waitFor('Finder to list Docs/a.txt and Docs/b.txt', () =>
        mac.finderList().includes('Docs') && mac.finderList('Docs').length === 2 ? true : undefined,
      ),
    )
    const folders = async (device: typeof laptop | typeof mac) =>
      (await device.sql<{ path: string }>('SELECT path FROM directories ORDER BY path')).map(
        (r) => r.path,
      )
    const trashed = async (device: typeof laptop | typeof mac) =>
      (
        await device.sql<{ name: string }>(
          `SELECT name FROM files WHERE kind = 'file' AND trashedAt IS NOT NULL AND deletedAt IS NULL ORDER BY name`,
        )
      ).map((r) => r.name)

    await step('the Mac deletes Docs in Finder', () => mac.finderRemove('Docs'))
    await step('the laptop has both files in the trash', () =>
      waitFor('a.txt and b.txt in the laptop trash', async () =>
        (await trashed(laptop)).join() === 'a.txt,b.txt' ? true : undefined,
      ),
    )
    await step('both converge', () => converge())
    checkEqual('the Mac keeps no folders', await folders(mac), [])
    checkEqual('the laptop keeps no folders', await folders(laptop), [])

    const entries =
      await laptop.call<{ id: string; kind: string; name: string; folder: string | null }[]>(
        'files.trashEntries',
      )
    checkEqual(
      "the laptop's trash lists Docs as one item",
      entries.map((e) => [e.kind, e.name, e.folder]),
      [['folder', 'Docs', null]],
    )

    await step('the laptop restores everything the delete put in the trash', async () => {
      await laptop.call(
        'files.restoreTrashEntries',
        entries.map((e) => e.id),
      )
      await converge()
    })
    await step('Docs comes back in the Finder folder with both files', () =>
      waitFor('Finder to list Docs/a.txt and Docs/b.txt again', () =>
        mac.finderList().includes('Docs') && mac.finderList('Docs').length === 2 ? true : undefined,
      ),
    )
    checkEqual('Finder lists both files in Docs', mac.finderList('Docs').sort(), ['a.txt', 'b.txt'])

    await step('the Mac deletes both files in Finder and writes c.txt into Docs', async () => {
      await mac.finderRemove('Docs/a.txt')
      await mac.finderRemove('Docs/b.txt')
      await mac.finderWrite('Docs/c.txt', new TextEncoder().encode(`c ${crypto.randomUUID()}`))
    })
    await step('the laptop has c.txt in Docs', () =>
      waitFor('c.txt in Docs on the laptop', async () => {
        const [row] = await laptop.sql<{ path: string | null }>(
          `SELECT d.path FROM files f LEFT JOIN directories d ON d.id = f.directoryId
            WHERE f.name = 'c.txt' AND f.kind = 'file' AND f.trashedAt IS NULL`,
        )
        return row?.path === 'Docs' ? true : undefined
      }),
    )
    await step('both converge', () => converge())
    check('the Mac has Docs with c.txt', (await folders(mac)).join() === 'Docs')
    check('the laptop has Docs with c.txt', (await folders(laptop)).join() === 'Docs')
  },
})
