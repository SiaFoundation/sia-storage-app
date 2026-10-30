import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: "trashing a folder's last file on the phone closes the folder and removes it, and Delete folder puts it in the trash as one item",
  description:
    "The laptop adds a.txt to Trips and b.txt to Docs. The phone opens Trips and moves a.txt to the trash, which takes it back to Files with Trips gone there and on the laptop. The phone then opens Docs and deletes it from the folder's actions, which takes it back to Files, removes Docs on both devices, and lists Docs in the phone's trash as one item beside a.txt.",
  devices: { phone: 'phone', laptop: 'cli' },
  async run({ devices: { phone, laptop }, converge, step, precondition, checkEqual, workDir }) {
    await step('the laptop adds a.txt to Trips and b.txt to Docs', async () => {
      for (const [name, dir] of [
        ['a.txt', 'Trips'],
        ['b.txt', 'Docs'],
      ]) {
        const path = `${workDir}/${name}`
        await Bun.write(path, `${name} ${crypto.randomUUID()}`)
        await laptop.addFile(path, { dir })
      }
      await converge()
    })
    const folders = async (device: typeof laptop | typeof phone) =>
      (await device.sql<{ path: string }>('SELECT path FROM directories ORDER BY path')).map(
        (r) => r.path,
      )
    const ui = phone.ui()

    await step('open a.txt in Trips', async () => {
      await ui.tap({ label: 'Files' })
      await ui.tap({ contains: 'Trips' })
      await ui.tap({ contains: 'a.txt' })
    })
    await precondition('the file is open in the viewer', async () => {
      await ui.waitFor({ label: 'More actions' })
      return true
    })
    await step('move it to the trash', async () => {
      await ui.tap({ label: 'More actions' })
      await ui.tap({ text: 'Move to trash' })
    })
    await step('the phone goes back to Files, where Trips is gone', async () => {
      await ui.waitFor({ contains: 'Docs' })
      await ui.waitForGone({ contains: 'Trips' })
    })
    checkEqual('the phone keeps only Docs', await folders(phone), ['Docs'])
    await step('both converge', () => converge())
    checkEqual('the laptop keeps only Docs', await folders(laptop), ['Docs'])

    await step('open Docs and delete it from its actions', async () => {
      await ui.tap({ contains: 'Docs' })
      await ui.waitFor({ contains: 'b.txt' })
      await ui.tap({ label: 'More actions' })
      await ui.tap({ text: 'Delete folder' })
      await ui.tap({ text: 'Delete' })
    })
    await step('the phone goes back to Files, where Docs is gone', () =>
      ui.waitForGone({ contains: 'Docs' }),
    )
    checkEqual('the phone keeps no folders', await folders(phone), [])
    await step('both converge', () => converge())
    checkEqual('the laptop keeps no folders', await folders(laptop), [])
    const entries =
      await phone.call<{ kind: string; name: string; folder: string | null }[]>(
        'files.trashEntries',
      )
    checkEqual(
      "the phone's trash lists Docs as one item beside a.txt",
      entries.map((e) => [e.kind, e.name, e.folder]).sort(),
      [
        ['file', 'a.txt', 'Trips'],
        ['folder', 'Docs', null],
      ],
    )
    await ui.close()
  },
})
