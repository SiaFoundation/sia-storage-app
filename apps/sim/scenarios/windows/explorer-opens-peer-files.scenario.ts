import { readFileSync } from 'node:fs'
import { sha256 } from '../../src/integrity'
import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: "files a laptop adds open from the PC's File Explorer folder with their bytes",
  description:
    "The laptop adds three files. They appear in the PC's File Explorer folder as placeholders with no bytes on the PC, and opening each one through the folder downloads it with the bytes the laptop added. The PC's daemon then has each recorded as held by File Explorer, and keeps no copy of its own.",
  devices: { pc: 'windows', laptop: 'cli' },
  timeoutMs: 8 * 60_000,
  async run({ devices, seed, converge, step, checkEqual, waitFor }) {
    const { pc } = devices
    const files = await step('laptop adds 3 files', () =>
      seed('laptop', { count: 3, size: 128 * 1024 }),
    )
    await step('both converge', () => converge())
    await step('the files appear in the File Explorer folder', () =>
      waitFor(
        'the folder to list them',
        async () => {
          const names = await pc.explorerList()
          return files.every((f) => names.includes(f.name))
        },
        { timeoutMs: 60_000, intervalMs: 500 },
      ),
    )
    const cloudOnly = async () => {
      const names = []
      for (const f of files) if (await pc.isCloudOnly(f.name)) names.push(f.name)
      return names
    }
    checkEqual(
      'each file has no bytes on the PC before it is opened',
      await cloudOnly(),
      files.map((f) => f.name),
    )
    const wrong: string[] = []
    for (const f of files) {
      const bytes = await step(`open ${f.name}`, () => pc.explorerRead(f.name))
      if (sha256(bytes) !== sha256(readFileSync(f.path))) wrong.push(f.name)
    }
    checkEqual("every opened file has the laptop's bytes", wrong, [])
    checkEqual('an opened file is on the PC', await cloudOnly(), [])
    const held = () =>
      pc.sql<{ stackId: string }>(
        'SELECT stackId FROM mount_copies WHERE whole = 1 ORDER BY stackId',
      )
    await waitFor(
      'the daemon to record all three as held by File Explorer',
      async () => (await held()).length === files.length,
      { timeoutMs: 120_000, intervalMs: 500 },
    )
    checkEqual(
      'the daemon has each file recorded as held by File Explorer',
      (await held()).map((r) => r.stackId),
      files.map((f) => f.id).sort(),
    )
    checkEqual('the daemon keeps no copy of its own', await pc.sql('SELECT fileId FROM fs'), [])
  },
})
