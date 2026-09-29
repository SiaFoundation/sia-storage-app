import { readFileSync } from 'node:fs'
import { type NameStyle, seedTypedFiles, type TypedFile, typeProblems } from '../../src/filetypes'
import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'a file saved in Finder gets the type any other app gives the same file',
  description:
    'The Mac saves PNG, PDF, Markdown, Word and video files into its Finder folder, named with their own extension, in upper case, with none, and with the wrong one. The laptop receives each under its name, with the type the laptop gives the same file when it adds it, read from its bytes first, and with its bytes.',
  devices: { mac: 'desktop', laptop: 'cli' },
  timeoutMs: 8 * 60_000,
  async run({
    devices: { mac, laptop },
    converge,
    step,
    checkEqual,
    checkContent,
    waitFor,
    workDir,
  }) {
    const styles: NameStyle[] = ['plain', 'none', 'wrong', 'upper']
    const saved: TypedFile[] = []
    for (const style of styles) {
      saved.push(
        ...(await seedTypedFiles(`${workDir}/finder-${style}`, {
          types: ['png', 'pdf', 'md', 'docx', 'm4v'],
          count: 1,
          names: style,
          prefix: `finder-${style}`,
        })),
      )
    }
    await step('save the files into the Finder folder', async () => {
      for (const f of saved) await mac.finderWrite(f.name, readFileSync(f.path))
    })
    await step('the laptop gets them', () =>
      waitFor(
        'the saved files on the laptop',
        async () => {
          const names = new Set((await laptop.library()).map((e) => e.name))
          return saved.every((f) => names.has(f.name))
        },
        { timeoutMs: 180_000, intervalMs: 2000 },
      ),
    )
    await step('both converge', () => converge())
    const problems = await typeProblems(laptop, saved)
    checkEqual('the laptop holds every file under its name', problems.missing, [])
    checkEqual('each file has the type the laptop gives it', problems.wrongType, [])
    checkEqual(
      'the laptop records the hash of the bytes saved for each file',
      problems.wrongHash,
      [],
    )
    await checkContent()
  },
})
