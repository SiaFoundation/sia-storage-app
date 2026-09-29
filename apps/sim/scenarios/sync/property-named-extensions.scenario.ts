import { storedAs, typeProblems } from '../../src/filetypes'
import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'a file whose extension is spelled like a JavaScript property is stored as unknown data',
  description:
    'The laptop adds text files with no byte signature named with the extension .constructor, a property every JavaScript object inherits. Two other devices converge, and every device stores application/octet-stream, the type for an extension the apps do not know.',
  devices: { laptop: 'cli', desk: 'cli', spare: 'cli' },
  knownBug:
    "The extension table is a plain object, so .constructor reads the property every object inherits, and the file's type is stored as the source text of Object's constructor.",
  // The lookup returns the Object constructor every plain object inherits.
  bugShowsAs: ['laptop', 'desk', 'spare'].map((device) => ({
    check: `${device} stores application/octet-stream`,
    matches: storedAs('function Object() { [native code] }'),
  })),
  timeoutMs: 8 * 60_000,
  async run({ devices, seedTypes, converge, step, checkEqual }) {
    const files = await step('laptop adds text files named with .constructor', () =>
      seedTypes('laptop', { types: ['text'], names: 'proto' }),
    )
    await step('all three converge', () => converge(undefined, { timeoutMs: 5 * 60_000 }))
    for (const [name, device] of Object.entries(devices)) {
      const problems = await typeProblems(device, files)
      checkEqual(`${name} holds every file under its exact name`, problems.missing, [])
      checkEqual(`${name} stores application/octet-stream`, problems.wrongType, [])
    }
  },
})
