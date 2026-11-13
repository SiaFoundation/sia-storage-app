import { readFileSync } from 'node:fs'
import { sha256 } from '../../src/integrity'
import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: "a rename, a move and a delete made on a laptop show up in the PC's File Explorer folder, and are not sent back",
  description:
    "The laptop adds three files, and the PC opens one of them in its File Explorer folder. On the laptop the opened file is renamed, the second is moved into a folder and the third is trashed. The PC's folder ends with the first under its new name, still holding its bytes, the second in the folder and the third gone. The provider makes those changes in the folder itself, and the laptop's library is the same afterwards, with nothing renamed back, trashed or saved again by the PC.",
  devices: { pc: 'windows', laptop: 'cli' },
  timeoutMs: 8 * 60_000,
  async run({ devices, seed, converge, step, precondition, check, checkEqual, waitFor }) {
    const { pc, laptop } = devices
    const [renamed, moved, trashed] = await step('laptop adds 3 files', () =>
      seed('laptop', { count: 3, size: 64 * 1024 }),
    )
    await step('both converge', () => converge())
    await step('the files appear in the File Explorer folder', () =>
      waitFor('the folder to list them', async () => (await pc.explorerList()).length === 3, {
        timeoutMs: 60_000,
        intervalMs: 500,
      }),
    )
    await step('the PC opens the first', () => pc.explorerRead(renamed.name))

    await step('the laptop renames the first, moves the second and trashes the third', async () => {
      await laptop.call('files.renameFile', renamed.id, 'renamed.bin')
      const sorted = await laptop.call<{ id: string }>('directories.create', 'sorted')
      await laptop.call('files.moveFile', moved.id, sorted.id)
      await laptop.call('files.trashFile', trashed.id)
    })
    await precondition('the laptop has the second file in the folder', async () =>
      (await laptop.library()).some((f) => f.id === moved.id && f.dir === 'sorted'),
    )
    const before = await step('both converge', async () => {
      await converge()
      return laptop.library()
    })

    await step('the PC’s folder shows each change', () =>
      waitFor(
        'the new name, the folder and the trashed file gone',
        async () => {
          const names = await pc.explorerList()
          return (
            names.includes('renamed.bin') &&
            names.includes('sorted') &&
            !names.includes(trashed.name)
          )
        },
        { timeoutMs: 60_000, intervalMs: 500 },
      ),
    )
    checkEqual(
      'the folder holds the renamed file and the new folder',
      (await pc.explorerList()).sort(),
      ['renamed.bin', 'sorted'],
    )
    checkEqual('the moved file is in the folder', await pc.explorerList('sorted'), [moved.name])
    check('the renamed file still holds its bytes', !(await pc.isCloudOnly('renamed.bin')))
    checkEqual(
      'the renamed file opens with the bytes it had',
      sha256(await pc.explorerRead('renamed.bin')),
      sha256(readFileSync(renamed.path)),
    )

    // Time for the PC to send anything its own changes to the folder set off.
    await Bun.sleep(5000)
    await step('both converge', () => converge())
    checkEqual("the laptop's library is as the laptop left it", await laptop.library(), before)
  },
})
