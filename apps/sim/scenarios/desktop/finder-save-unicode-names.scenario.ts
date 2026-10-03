import { readFileSync } from 'node:fs'
import { seedTypedFiles } from '../../src/filetypes'
import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'a name with accents saved in Finder reaches other devices in the same form a phone uses',
  description:
    'The Mac saves files named with accented letters and other scripts into its Finder folder. The laptop holds each under the composed (NFC) form of its name, the form phones and most apps produce, so the same visible name from any app is the same name to the library.',
  devices: { mac: 'desktop', laptop: 'cli' },
  knownBug:
    'The Finder folder hands the provider every name decomposed (NFD), and the provider stores it as given, so café.txt saved in Finder and café.txt added on a phone are two different names, and versions, which the library groups by name, do not match.',
  bugShowsAs: ['holds each name in composed form'],
  timeoutMs: 6 * 60_000,
  async run({ devices: { mac, laptop }, step, checkEqual, waitFor, workDir }) {
    const saved = await seedTypedFiles(`${workDir}/finder-unicode`, {
      types: ['png', 'md', 'pdf'],
      count: 1,
      names: 'unicode',
      prefix: 'finder',
    })
    await step('save the files into the Finder folder', async () => {
      for (const f of saved) await mac.finderWrite(f.name, readFileSync(f.path))
    })
    const nfc = new Set(saved.map((f) => f.name.normalize('NFC')))
    const names = await waitFor(
      'the laptop to hold a file for each save',
      async () => {
        const got = (await laptop.library()).map((e) => e.name)
        const ours = got.filter((n) => n.normalize('NFC').startsWith('finder'))
        return ours.length >= saved.length ? ours : undefined
      },
      { timeoutMs: 120_000, intervalMs: 2000 },
    )
    checkEqual(
      'the laptop holds each name in composed form',
      names
        .filter((n) => !nfc.has(n))
        .map((n) => `${n} (${n.normalize('NFC') === n ? 'NFC' : 'NFD'})`),
      [],
    )
  },
})
