import { readFileSync } from 'node:fs'
import { commonImages, NAME_STYLES, typeProblems } from '../../src/filetypes'
import { sha256 } from '../../src/integrity'
import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: "every type shows in the Mac's Finder folder with its extension, and the Mac stores its real type",
  description:
    "The laptop adds a real file of every type, named in the shapes past bugs turned on. The Mac's Finder folder lists each under its name with its extension shown, and the common image types read back through Finder with the laptop's bytes.",
  devices: { mac: 'desktop', laptop: 'cli' },
  timeoutMs: 12 * 60_000,
  async run({ devices, seedTypes, converge, step, checkEqual, waitFor }) {
    const { mac } = devices
    const files = await step('laptop adds a file of every type', () =>
      seedTypes('laptop', {
        types: ['all'],
        // Names with `#` or a property-named extension have scenarios of their own.
        names: NAME_STYLES.filter((s) => s !== 'hash' && s !== 'proto'),
      }),
    )
    await step('both converge', () => converge(undefined, { timeoutMs: 5 * 60_000 }))
    checkEqual(
      'the Mac stores the type the corpus expects for each file’s bytes and name',
      (await typeProblems(mac, files)).wrongType,
      [],
    )
    await step('Finder lists every file', () =>
      waitFor(
        'the Finder folder to list every file',
        () => {
          const listed = new Set(mac.finderList())
          return files.every((f) => listed.has(f.name))
        },
        { timeoutMs: 120_000, intervalMs: 1000 },
      ),
    )
    const listed = new Set(mac.finderList())
    checkEqual(
      'Finder lists every file under its name',
      files.filter((f) => !listed.has(f.name)).map((f) => f.name),
      [],
    )
    const states = files.map((f) => ({ f, state: mac.finderState(f.name) }))
    checkEqual(
      'Finder shows every extension',
      states.filter((s) => s.state.extensionHidden).map((s) => s.f.name),
      [],
    )
    const wrong: string[] = []
    for (const f of commonImages(files)) {
      const bytes = await mac.finderRead(f.name)
      if (sha256(bytes) !== sha256(readFileSync(f.path))) wrong.push(f.name)
    }
    checkEqual("images read through Finder hold the laptop's bytes", wrong, [])
  },
})
