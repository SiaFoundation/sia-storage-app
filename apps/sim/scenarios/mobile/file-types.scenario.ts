import { commonImages, NAME_STYLES, thumbnailed, typeProblems } from '../../src/filetypes'
import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'a file of every type imported on the phone keeps its name and type, and shows by name',
  description:
    "The phone imports one real file for every type in the file-type corpus through its file picker, named in the shapes past bugs turned on. The phone and a laptop both hold every file under its exact name, with the type its bytes and name call for and the phone's bytes, and every JPEG and PNG gets a thumbnail on both. On the phone's screen, the Files tab's No folder list shows the files with the hardest names.",
  devices: { phone: 'phone', laptop: 'cli' },
  knownBug:
    "A file the phone imports whose bytes call for a different extension than its name gives, such as a PNG named .txt, a file with no extension, or an .m4v holding MP4, keeps its bytes under the name's extension. The app then finds no local copy at the path its new type names, so the file never uploads and the two devices never agree.",
  bugShowsAs: [
    'the phone and the laptop agree',
    'holds every file under its exact name',
    "stores each file's expected type",
    'records the hash',
    'has a thumbnail for every JPEG and PNG',
  ],
  timeoutMs: 15 * 60_000,
  async run({ devices, seedTypes, converge, step, checkEqual, checkContent, check, waitFor }) {
    const { phone } = devices
    const files = await step('phone imports a file of every type', () =>
      seedTypes('phone', {
        types: ['all'],
        names: NAME_STYLES.filter((s) => s !== 'hash' && s !== 'proto'),
      }),
    )
    // Every file is small, so two minutes is ample, and when the devices never
    // agree the checks below still run and name the files they differ on.
    const converged = await step('both converge', () =>
      converge(undefined, { timeoutMs: 2 * 60_000 }),
    )
      .then(() => true)
      .catch(() => false)
    check('the phone and the laptop agree', converged)
    for (const [name, device] of Object.entries(devices)) {
      const problems = await typeProblems(device, files)
      checkEqual(`${name} holds every file under its exact name`, problems.missing, [])
      checkEqual(`${name} stores each file's expected type`, problems.wrongType, [])
      checkEqual(
        `${name} records the hash of the bytes added for each file`,
        problems.wrongHash,
        [],
      )
    }
    await checkContent()
    const images = commonImages(files)
    for (const [name, device] of Object.entries(devices)) {
      const missing = await waitFor(
        `thumbnails on ${name}`,
        async () => {
          const have = await thumbnailed(device)
          const left = images.filter((f) => !have.has(f.name)).map((f) => f.name)
          return left.length === 0 ? left : undefined
        },
        // Devices that never agreed are missing files, whose thumbnails will
        // not come however long this waits.
        { timeoutMs: converged ? 120_000 : 10_000, intervalMs: 3000 },
      ).catch(async () => {
        const have = await thumbnailed(device)
        return images.filter((f) => !have.has(f.name)).map((f) => f.name)
      })
      checkEqual(`${name} has a thumbnail for every JPEG and PNG`, missing, [])
    }
    const ui = phone.ui()
    await step('open the Files tab', () => ui.tap({ label: 'Files' }))
    await step('open the files in no folder', () => ui.tap({ contains: 'No folder' }))
    const hardest = ['unicode', 'spaces', 'upper', 'none', 'wrong', 'double']
      .map((style) => files.find((f) => f.style === style))
      .filter((f) => f !== undefined)
    for (const f of hardest) {
      // The list may have scrolled past a name the last step looked for, so a
      // search that reaches the end turns and looks back the other way.
      // A row's label is the name followed by its status, size and type.
      const row = { contains: `${f.name}, ` }
      const shown = await ui
        .scrollTo(row)
        .catch(() => ui.scrollTo(row, 'down'))
        .then(() => true)
        .catch(() => false)
      check(`the phone shows ${f.name} by name`, shown)
    }
  },
})
