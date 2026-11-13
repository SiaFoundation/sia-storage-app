import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: "a rename, a move, and a delete of a file and of a folder in the PC's File Explorer folder show up on a laptop",
  description:
    'The laptop adds four files. On the PC, through the File Explorer folder, one is renamed, two are moved into a new folder, and the last is deleted. The laptop ends with the new name, the two files in the folder and the last in the trash. The folder is then renamed and deleted on the PC, and the laptop ends with both of its files in the trash. Last, the renamed file is deleted as File Explorer’s Delete does it, by moving it to the Recycle Bin, and the laptop ends with it in the trash too.',
  devices: { pc: 'windows', laptop: 'cli' },
  timeoutMs: 8 * 60_000,
  async run({ devices, seed, converge, step, checkEqual, waitFor }) {
    const { pc, laptop } = devices
    const [kept, movedA, movedB, removed] = await step('laptop adds 4 files', () =>
      seed('laptop', { count: 4, size: 64 * 1024 }),
    )
    await step('both converge', () => converge())
    await step('the files appear in the File Explorer folder', () =>
      waitFor('the folder to list them', async () => (await pc.explorerList()).length === 4, {
        timeoutMs: 60_000,
        intervalMs: 500,
      }),
    )
    const laptopFiles = async () => new Map((await laptop.library()).map((f) => [f.id, f]))
    const onLaptop = (
      what: string,
      holds: (files: Awaited<ReturnType<typeof laptopFiles>>) => boolean,
    ) =>
      waitFor(what, async () => holds(await laptopFiles()), {
        timeoutMs: 120_000,
        intervalMs: 1000,
      })

    await step('rename one in File Explorer', () => pc.explorerRename(kept.name, 'renamed.bin'))
    await step('move two into a new folder', async () => {
      // A file whose bytes are on the PC is moved too, which Windows reports as it does one that is not.
      await pc.explorerRead(movedA.name)
      await pc.explorerWrite('sorted/placeholder.txt', new TextEncoder().encode('makes the folder'))
      await pc.explorerRename(movedA.name, `sorted/${movedA.name}`)
      await pc.explorerRename(movedB.name, `sorted/${movedB.name}`)
    })
    await step('delete the last', () => pc.explorerRemove(removed.name))
    await step('the laptop sees each change', () =>
      onLaptop(
        'the rename, the moves and the trash on the laptop',
        (files) =>
          files.get(kept.id)?.name === 'renamed.bin' &&
          files.get(movedA.id)?.dir === 'sorted' &&
          files.get(movedB.id)?.dir === 'sorted' &&
          files.get(removed.id)?.trashed === true,
      ),
    )
    let files = await laptopFiles()
    checkEqual('the laptop shows the new name', files.get(kept.id)?.name, 'renamed.bin')
    checkEqual(
      'the laptop shows both moved files in the new folder',
      [files.get(movedA.id)?.dir, files.get(movedB.id)?.dir],
      ['sorted', 'sorted'],
    )
    checkEqual(
      'the laptop shows the deleted file in the trash',
      files.get(removed.id)?.trashed,
      true,
    )

    await step('rename the folder, then delete it', async () => {
      await pc.explorerRename('sorted', 'filed')
      await onLaptop(
        'the folder under its new name on the laptop',
        (f) => f.get(movedA.id)?.dir === 'filed',
      )
      await pc.explorerRemove('filed')
    })
    await step('the laptop sees the folder go', () =>
      onLaptop(
        "the folder's files in the trash on the laptop",
        (f) => f.get(movedA.id)?.trashed === true && f.get(movedB.id)?.trashed === true,
      ),
    )
    files = await laptopFiles()
    checkEqual(
      "the laptop shows the deleted folder's files in the trash",
      [files.get(movedA.id)?.trashed, files.get(movedB.id)?.trashed],
      [true, true],
    )
    checkEqual('the renamed file is still there', files.get(kept.id)?.trashed, false)

    await step('delete the renamed file to the Recycle Bin', () =>
      pc.explorerRecycle('renamed.bin'),
    )
    await step('the laptop sees it go', () =>
      onLaptop(
        'the recycled file in the trash on the laptop',
        (f) => f.get(kept.id)?.trashed === true,
      ),
    )
    await step('both converge', () => converge())
    checkEqual(
      'the laptop shows the file deleted to the Recycle Bin in the trash',
      (await laptopFiles()).get(kept.id)?.trashed,
      true,
    )
  },
})
