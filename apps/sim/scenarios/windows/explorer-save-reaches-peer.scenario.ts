import { fileHash, sha256 } from '../../src/integrity'
import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: "a file saved in the PC's File Explorer folder, a save over it and a new folder show up on a laptop",
  description:
    'A file is saved into the File Explorer folder on the PC, then saved over with new bytes, and a second file is saved into a new folder there. The laptop ends with the first file holding the second save as its current version and the first save as an older one, and with the second file in the new folder. On the PC, File Explorer shows both files in sync at the version saved last.',
  devices: { pc: 'windows', laptop: 'cli' },
  timeoutMs: 8 * 60_000,
  async run({ devices, converge, step, checkEqual, waitFor }) {
    const { pc, laptop } = devices
    const first = crypto.getRandomValues(new Uint8Array(96 * 1024))
    const second = crypto.getRandomValues(new Uint8Array(48 * 1024))
    const inner = crypto.getRandomValues(new Uint8Array(16 * 1024))
    const onLaptop = (name: string, bytes: Uint8Array) =>
      waitFor(
        `${name} with those bytes on the laptop`,
        async () =>
          (await laptop.library()).find(
            (f) => f.name === name && f.current && f.uploaded && fileHash(f.hash) === sha256(bytes),
          ),
        { timeoutMs: 120_000, intervalMs: 1000 },
      )
    await step('a file is saved in File Explorer', () => pc.explorerWrite('saved.bin', first))
    const original = await step('the laptop gets it', () => onLaptop('saved.bin', first))
    await step('the file is saved over', () => pc.explorerWrite('saved.bin', second))
    const edited = await step('the laptop gets the new version', () =>
      onLaptop('saved.bin', second),
    )
    await step('a file is saved into a new folder', () => pc.explorerWrite('docs/inner.bin', inner))
    const nested = await step('the laptop gets it', () => onLaptop('inner.bin', inner))
    await step('both converge', () => converge())

    const versions = (await laptop.library()).filter((f) => f.name === 'saved.bin')
    checkEqual(
      'the laptop holds both saves as versions of one file, the second current',
      versions.map((f) => [f.id, f.current]).sort(),
      [
        [original.id, false],
        [edited.id, true],
      ].sort(),
    )
    checkEqual('the second file is in the new folder on the laptop', nested.dir, 'docs')
    // A file saved in the folder is a plain file until it uploads, which File
    // Explorer shows as sync-pending. The provider then makes it a placeholder
    // in sync, the tick.
    const shown = await waitFor(
      'both saved files to show as in sync in File Explorer',
      async () => {
        const states = await pc.explorerStates(['saved.bin', 'docs/inner.bin'])
        return states.every((s) => s.inSync) ? states : false
      },
      { timeoutMs: 60_000, intervalMs: 1000 },
    )
    checkEqual(
      'File Explorer shows both files in sync and on the PC, at the version saved last',
      shown.map((s) => ({
        cloudOnly: s.cloudOnly,
        inSync: s.inSync,
        version: fileHash(s.identity?.split('\n')[1] ?? ''),
      })),
      [
        { cloudOnly: false, inSync: true, version: sha256(second) },
        { cloudOnly: false, inSync: true, version: sha256(inner) },
      ],
    )
  },
})
