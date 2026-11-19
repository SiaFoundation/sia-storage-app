import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { defineScenario } from '../../src/scenario'

const SIZE = 384 * 1024 * 1024

export default defineScenario({
  name: "reading a large file through the PC's File Explorer folder writes about the file's size to disk",
  description:
    "The laptop adds a 384 MiB file, which a program on the PC reads whole through the File Explorer folder. The provider fetches it from the daemon 4 MiB at a time, and the daemon hands each range over in a file of its own. The PC's data directory is on NTFS, where a range written at its offset in a new file has every byte before it written as zeros first, which for this file is over 40 times its size. The read ends with the laptop's bytes, and the PC's disk has written under 4 times the file's size.",
  devices: { pc: 'windows', laptop: 'cli' },
  timeoutMs: 15 * 60_000,
  async run({ devices, seed, converge, step, check, checkEqual, note, waitFor }) {
    const { pc } = devices
    const [file] = await step('laptop adds a 384 MiB file', () =>
      seed('laptop', { count: 1, size: SIZE }),
    )
    await step('both converge', () => converge(undefined, { timeoutMs: 5 * 60_000 }))
    await step('the file appears in the File Explorer folder', () =>
      waitFor('the folder to list it', async () => (await pc.explorerList()).includes(file.name), {
        timeoutMs: 60_000,
        intervalMs: 500,
      }),
    )
    const expected = createHash('sha256')
    for await (const chunk of createReadStream(file.path)) expected.update(chunk)

    const before = await pc.diskWritten()
    const started = Date.now()
    const read = await step('a program reads the whole file', () => pc.explorerHash(file.name))
    const seconds = (Date.now() - started) / 1000
    // Windows writes what it buffered a few seconds after the read returns.
    await Bun.sleep(5000)
    const written = (await pc.diskWritten()) - before

    note(
      `read in ${seconds.toFixed(1)} s, with ${(written / SIZE).toFixed(1)} times the file's size written to disk`,
    )
    checkEqual("the file read has the laptop's bytes", read, expected.digest('hex'))
    check(
      "the PC's disk wrote under 4 times the file's size",
      written < 4 * SIZE,
      `${written} bytes`,
    )
    check('the file is on the PC', !(await pc.isCloudOnly(file.name)))
  },
})
