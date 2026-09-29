import { commonImages, NAME_STYLES, thumbnailed, typeProblems } from '../../src/filetypes'
import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'a file of every type keeps its exact name and type on every device',
  description:
    'The laptop adds one real file for every type in the file-type corpus, each named in one of the shapes past bugs turned on: its own extension, upper case, none, the wrong one, spaces, other scripts, and a double extension. Two other devices converge. Every device holds every file under its exact name, with the type its bytes and name call for and the bytes the laptop added, and every JPEG and PNG gets a thumbnail that reaches every device.',
  devices: { laptop: 'cli', desk: 'cli', spare: 'cli' },
  timeoutMs: 10 * 60_000,
  async run({ devices, seedTypes, converge, step, checkEqual, checkContent, waitFor }) {
    const files = await step('laptop adds a file of every type', () =>
      seedTypes('laptop', {
        types: ['all'],
        // Names with `#` or a property-named extension have a scenario of their own.
        names: NAME_STYLES.filter((s) => s !== 'hash' && s !== 'proto'),
      }),
    )
    await step('all three converge', () => converge(undefined, { timeoutMs: 5 * 60_000 }))
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
        { timeoutMs: 90_000, intervalMs: 2000 },
      ).catch(async () => {
        const have = await thumbnailed(device)
        return images.filter((f) => !have.has(f.name)).map((f) => f.name)
      })
      checkEqual(`${name} has a thumbnail for every JPEG and PNG`, missing, [])
    }
  },
})
