import { typeProblems } from '../../src/filetypes'
import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'a file named with a # keeps the type its extension names on every device',
  description:
    'The laptop adds text and document files, each named with a # before the extension. The app finds no byte signature in the text files or in .rtf, .doc, .xls, .ppt, .mobi and .azw3, and types .docx, .xlsx, .pptx and .epub zips by extension, so for those files the extension after the # decides the type. Two other devices converge, and every device holds each file under its exact name with the type it would have without the #.',
  devices: { laptop: 'cli', desk: 'cli', spare: 'cli' },
  timeoutMs: 8 * 60_000,
  async run({ devices, seedTypes, converge, step, checkEqual }) {
    const files = await step('laptop adds text and documents named with a #', () =>
      seedTypes('laptop', { types: ['text', 'document'], names: 'hash' }),
    )
    await step('all three converge', () => converge(undefined, { timeoutMs: 5 * 60_000 }))
    for (const [name, device] of Object.entries(devices)) {
      const problems = await typeProblems(device, files)
      checkEqual(`${name} holds every file under its exact name`, problems.missing, [])
      checkEqual(`${name} stores each file's type as if its name had no #`, problems.wrongType, [])
    }
  },
})
