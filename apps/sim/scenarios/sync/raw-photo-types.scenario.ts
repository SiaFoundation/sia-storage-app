import { typeProblems } from '../../src/filetypes'
import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'a camera raw photo added on a laptop keeps its raw type on every device',
  description:
    'The laptop adds DNG, CR2, NEF, NRW, ARW and PEF files under their own extensions. Two other devices converge, and every device stores the raw type each extension names rather than TIFF, the format their first bytes share.',
  devices: { laptop: 'cli', desk: 'cli', spare: 'cli' },
  knownBug:
    'The daemon types a file by its bytes first, and DNG and the raw formats built on TIFF begin with TIFF’s signature, so a .dng is stored as image/tiff.',
  bugShowsAs: ["stores each photo's raw type"],
  timeoutMs: 6 * 60_000,
  async run({ devices, seedTypes, converge, step, checkEqual }) {
    const files = await step('laptop adds a raw photo of each TIFF-based format', () =>
      seedTypes('laptop', { types: ['dng', 'cr2', 'nef', 'nrw', 'arw', 'pef'], names: 'plain' }),
    )
    await step('all three converge', () => converge(undefined, { timeoutMs: 3 * 60_000 }))
    for (const [name, device] of Object.entries(devices)) {
      const problems = await typeProblems(device, files, (f) => f.sample.mime)
      checkEqual(`${name} holds every photo under its exact name`, problems.missing, [])
      checkEqual(`${name} stores each photo's raw type`, problems.wrongType, [])
    }
  },
})
