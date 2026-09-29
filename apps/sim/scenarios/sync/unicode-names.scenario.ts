import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'a name typed or read in decomposed form is stored composed on every device',
  description:
    'The laptop adds a file whose name on disk is decomposed (NFD), the form macOS file systems often hand back, and renames another to a decomposed name. Both devices hold both names composed (NFC), the form phones and most apps produce.',
  devices: { laptop: 'cli', desk: 'cli' },
  knownBug:
    'Names are stored exactly as given, so a decomposed name differs byte for byte from the same name composed, and the library treats them as two names.',
  // Each name is stored exactly as it was given, decomposed.
  bugShowsAs: ['laptop', 'desk'].map((device) => ({
    check: `${device} holds both names composed`,
    matches: (names: string[]) =>
      names.length === 2 && names.every((n) => n !== n.normalize('NFC')),
  })),
  async run({ devices, seed, converge, step, checkEqual, workDir }) {
    const { laptop } = devices
    const decomposed = 'résumé-日本.txt'.normalize('NFD')
    const path = join(workDir, decomposed)
    writeFileSync(path, 'decomposed name')
    const added = await step('laptop adds a file named in decomposed form', () =>
      laptop.addFile(path),
    )
    const [other] = await step('laptop adds a second file', () =>
      seed('laptop', { count: 1, size: 512 }),
    )
    const renamed = 'café-über.txt'.normalize('NFD')
    await step('laptop renames it to a decomposed name', () =>
      laptop.call('files.renameFile', other.id, renamed),
    )
    await step('both converge', () => converge())
    for (const [name, device] of Object.entries(devices)) {
      const rows = await device.sql<{ id: string; name: string }>(
        'SELECT id, name FROM files WHERE id IN (?1, ?2)',
        added.id,
        other.id,
      )
      checkEqual(
        `${name} holds both names composed`,
        rows.map((r) => r.name).sort(),
        ['résumé-日本.txt', 'café-über.txt'].map((n) => n.normalize('NFC')).sort(),
      )
    }
  },
})
