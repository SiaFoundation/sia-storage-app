import { fileHash, sha256 } from '../../src/integrity'
import type { ExplorerState } from '../../src/devices/windows'
import { defineScenario } from '../../src/scenario'

/** The pause between the steps of the save, as a program leaves between its own. */
const STEP_MS = 300
const TEMP = '~SAVE0001.tmp'

export default defineScenario({
  name: "a file saved in the PC's File Explorer folder by deleting it and moving a new file in stays the same item on a laptop, at a new version",
  description:
    'The laptop adds a file, and the PC opens it from the File Explorer folder. The PC then saves over it the way some programs do: the new bytes are written to a temporary file, the original is deleted, and the temporary file is renamed to the original name, a few hundred milliseconds apart. The laptop ends with the file at a new version holding the new bytes and the first as an older version, nothing in its trash and the temporary name nowhere in its library. On the PC the file is the same placeholder item as before, in sync.',
  devices: { pc: 'windows', laptop: 'cli' },
  timeoutMs: 8 * 60_000,
  async run({ devices, seed, converge, step, precondition, checkEqual, waitFor }) {
    const { pc, laptop } = devices
    const [original] = await step('laptop adds a file', () =>
      seed('laptop', { count: 1, size: 96 * 1024 }),
    )
    await step('both converge', () => converge())
    await step('the PC opens it from File Explorer', () =>
      waitFor('the file to open with its bytes', async () =>
        (await pc.explorerList()).includes(original.name)
          ? (await pc.explorerRead(original.name)).length > 0
          : false,
      ),
    )
    // A precondition that returns false fails the scenario, so what it returns is the state.
    const before = (await precondition(
      'the PC holds the file as an in-sync placeholder',
      async () => {
        const state = await pc.explorerState(original.name)
        return state.placeholder && state.inSync && !state.cloudOnly ? state : false
      },
    )) as ExplorerState
    const item = (identity: string | null) => identity?.split('\n')[0]

    const saved = crypto.getRandomValues(new Uint8Array(80 * 1024))
    await step('the PC deletes the file and moves a new one in its place', async () => {
      await pc.explorerWrite(TEMP, saved)
      await Bun.sleep(STEP_MS)
      await pc.explorerRemove(original.name)
      await Bun.sleep(STEP_MS)
      await pc.explorerRename(TEMP, original.name)
    })
    const edited = await step('the laptop gets the new version', () =>
      waitFor(
        `${original.name} with the saved bytes on the laptop`,
        async () =>
          (await laptop.library()).find(
            (f) =>
              f.name === original.name &&
              f.current &&
              f.uploaded &&
              fileHash(f.hash) === sha256(saved),
          ),
        { timeoutMs: 120_000, intervalMs: 1000 },
      ),
    )
    await step('both converge', () => converge())

    const library = await laptop.library()
    checkEqual(
      'the laptop holds the save as the current version and the first as an older one',
      library
        .filter((f) => f.name === original.name)
        .map((f) => [f.id, f.current])
        .sort(),
      [
        [original.id, false],
        [edited.id, true],
      ].sort(),
    )
    checkEqual(
      'the laptop has nothing in its trash',
      library.filter((f) => f.trashed).map((f) => f.name),
      [],
    )
    checkEqual(
      'the temporary name never reached the laptop',
      library.filter((f) => f.name === TEMP).map((f) => f.name),
      [],
    )
    checkEqual(
      'the File Explorer folder holds only the saved file',
      (await pc.explorerList()).sort(),
      [original.name],
    )
    const after = await waitFor(
      'the saved file to show as in sync in File Explorer',
      async () => {
        const state = await pc.explorerState(original.name)
        return state.inSync ? state : false
      },
      { timeoutMs: 60_000, intervalMs: 1000 },
    )
    checkEqual(
      'File Explorer shows the saved file as the same item, in sync',
      { item: item(after.identity), placeholder: after.placeholder, inSync: after.inSync },
      { item: item(before.identity), placeholder: true, inSync: true },
    )
  },
})
