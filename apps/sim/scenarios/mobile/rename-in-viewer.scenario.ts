import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: "one tap on Rename renames a file from the viewer's details",
  description:
    'The phone opens a file, shows its details, opens Rename from the name row and types a new name, then taps Rename once. The sheet closes and the file has the new name.',
  devices: { phone: 'phone' },
  knownBug:
    "The rename sheet renders inside the details panel's scroll view, which dismisses the keyboard on the first tap and swallows it, so the first tap on Rename only closes the keyboard and a second is needed.",
  bugShowsAs: [
    {
      check: 'one tap on Rename closes the sheet',
      got: { sheetOpen: true, keyboardOpen: false },
    },
    { check: 'the file has the new name', got: 'viewer-0.bin' },
  ],
  async run({ devices: { phone }, seed, step, precondition, checkEqual }) {
    const [file] = await step('phone imports a file', () =>
      seed('phone', { count: 1, size: 1024, prefix: 'viewer' }),
    )
    const ui = phone.ui()
    await step("open the file and its details, then the name's Rename sheet", async () => {
      await ui.tap({ label: 'Files' })
      await ui.tap({ contains: 'No folder' })
      await ui.tap({ contains: file.name })
      await ui.tap({ label: 'Toggle file details' })
      await ui.tap({ contains: 'Name, ' })
    })
    await precondition('the Rename sheet is open', async () => {
      await ui.waitFor({ label: 'File name' })
      return true
    })
    const renamed = `renamed-${file.name}`
    // The field selects the name when it takes focus, so typing replaces it.
    await step('type a new name', () => ui.type({ label: 'File name' }, renamed))
    await step('tap Rename once', () => ui.tap({ text: 'Rename' }))
    const closed = await ui
      .waitForGone({ label: 'File name' }, 5_000)
      .then(() => true)
      .catch(() => false)
    // A tap the scroll view swallows closes the keyboard and leaves the sheet
    // open, where a tap that missed leaves both open.
    const keyboard = await phone.call<{ visible: boolean }>('sim.keyboard')
    checkEqual(
      'one tap on Rename closes the sheet',
      { sheetOpen: !closed, keyboardOpen: keyboard.visible },
      { sheetOpen: false, keyboardOpen: false },
    )
    const [row] = await phone.sql<{ name: string }>('SELECT name FROM files WHERE id = ?1', file.id)
    checkEqual('the file has the new name', row?.name, renamed)
    await ui.close()
  },
})
