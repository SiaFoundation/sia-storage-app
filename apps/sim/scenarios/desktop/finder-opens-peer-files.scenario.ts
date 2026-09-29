import { readFileSync } from 'node:fs'
import { sha256 } from '../../src/integrity'
import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: "files a laptop adds open from the Mac's Finder folder with their bytes",
  description:
    "The laptop adds three files. They appear in the Mac's Finder folder as cloud-only placeholders, and opening each one through the folder downloads it with the bytes the laptop added.",
  devices: { mac: 'desktop', laptop: 'cli' },
  timeoutMs: 8 * 60_000,
  async run({ devices, seed, converge, step, checkEqual, waitFor }) {
    const { mac } = devices
    const files = await step('laptop adds 3 files', () =>
      seed('laptop', { count: 3, size: 128 * 1024 }),
    )
    await step('both converge', () => converge())
    await step('the files appear in the Finder folder', () =>
      waitFor(
        'the Finder folder to list them',
        () => files.every((f) => mac.finderList().includes(f.name)),
        { timeoutMs: 60_000, intervalMs: 500 },
      ),
    )
    checkEqual(
      'each file is cloud-only before it is opened',
      files.filter((f) => !mac.isCloudOnly(f.name)).map((f) => f.name),
      [],
    )
    const wrong: string[] = []
    for (const f of files) {
      const bytes = await step(`open ${f.name}`, () => mac.finderRead(f.name))
      if (sha256(bytes) !== sha256(readFileSync(f.path))) wrong.push(f.name)
    }
    checkEqual("every opened file has the laptop's bytes", wrong, [])
    checkEqual(
      'an opened file is no longer cloud-only',
      files.filter((f) => mac.isCloudOnly(f.name)).map((f) => f.name),
      [],
    )
  },
})
