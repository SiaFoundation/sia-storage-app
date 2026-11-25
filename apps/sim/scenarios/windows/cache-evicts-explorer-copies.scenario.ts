import { sha256 } from '../../src/integrity'
import { defineScenario } from '../../src/scenario'

const NAMES = ['one.bin', 'two.bin', 'three.bin']
const SIZE = 64 * 1024
/** The hold the first pass uses, long enough to cover opening the other two files. */
const HOLD_S = 30

export default defineScenario({
  name: "an eviction pass frees File Explorer's copies on the PC that went unused past the hold, and keeps a file kept on the device",
  description:
    'Three files saved into the File Explorer folder upload. two.bin is opened, goes unused past a 30-second hold, and three.bin and one.bin are opened after it. With the hold at 30 seconds an eviction pass has the provider free two.bin and no other. three.bin is then marked Always keep on this device, and a pass with no hold frees one.bin while Windows refuses to let three.bin go. Every file still opens with its bytes.',
  devices: { pc: 'windows' },
  timeoutMs: 8 * 60_000,
  async run({ devices, step, precondition, checkEqual, waitFor }) {
    const { pc } = devices
    const contents = new Map(
      NAMES.map((name) => [name, crypto.getRandomValues(new Uint8Array(SIZE))]),
    )
    await step('three files are saved into the File Explorer folder', async () => {
      for (const [name, bytes] of contents) await pc.explorerWrite(name, bytes)
    })
    await precondition('every file is uploaded and only File Explorer holds it', () =>
      waitFor(
        'three uploads and no cache copy',
        async () => {
          const library = await pc.library()
          return (
            NAMES.every((n) => library.some((f) => f.name === n && f.uploaded)) &&
            (await pc.sql('SELECT fileId FROM fs')).length === 0
          )
        },
        { timeoutMs: 120_000, intervalMs: 1000 },
      ),
    )
    const lastUse = async (name: string) =>
      (
        await pc.sql<{ usedAt: number }>(
          'SELECT m.usedAt AS usedAt FROM files f JOIN mount_copies m ON m.fileId = f.id WHERE f.name = ?',
          name,
        )
      )[0]?.usedAt ?? 0
    const open = async (name: string) => {
      const before = await lastUse(name)
      await pc.explorerRead(name)
      await waitFor(
        `${name}'s last use to move forward`,
        async () => (await lastUse(name)) > before,
        {
          timeoutMs: 30_000,
          intervalMs: 500,
        },
      )
    }
    await step('two.bin is opened', () => open('two.bin'))
    await step('it goes unused past the hold', () => Bun.sleep((HOLD_S + 1) * 1000))
    await precondition('three.bin and one.bin are opened within the hold', async () => {
      const start = Date.now()
      for (const name of ['three.bin', 'one.bin']) await open(name)
      return Date.now() - start < HOLD_S * 1000
    })
    const onPc = async () => {
      const names = []
      for (const name of NAMES) if (!(await pc.isCloudOnly(name))) names.push(name)
      return names
    }
    const recorded = async () =>
      (
        await pc.sql<{ name: string }>(
          'SELECT f.name AS name FROM mount_copies m JOIN files f ON f.id = m.fileId ORDER BY f.name',
        )
      ).map((r) => r.name)

    await step('one eviction pass runs with the hold at 30 seconds', async () => {
      await pc.cli('config', 'set', 'cacheMinAge', `${HOLD_S}s`)
      await pc.call('cache.evict')
    })
    checkEqual('File Explorer dropped only the file unused past the hold', await onPc(), [
      'one.bin',
      'three.bin',
    ])
    checkEqual('the daemon has the other two recorded', await recorded(), ['one.bin', 'three.bin'])

    await step('three.bin is kept on this device', () => pc.keepOnDevice('three.bin'))
    await step('one eviction pass runs with no hold', async () => {
      await pc.cli('config', 'set', 'cacheMinAge', '0')
      await pc.call('cache.evict')
    })
    checkEqual('File Explorer holds only the file kept on this device', await onPc(), ['three.bin'])
    checkEqual('the daemon has only that file recorded', await recorded(), ['three.bin'])

    const wrong = []
    for (const [name, bytes] of contents) {
      if (sha256(await pc.explorerRead(name)) !== sha256(bytes)) wrong.push(name)
    }
    checkEqual('File Explorer opens every file again with its bytes', wrong, [])
  },
})
