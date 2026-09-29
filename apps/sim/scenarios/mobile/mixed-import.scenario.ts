import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'one import mixing an empty file, a name with spaces, a copy that is cancelled and normal files finishes every file',
  description:
    'The phone imports an empty file, a file whose name has spaces, and three ordinary files in one pick, and the first copy ends as cancelled, as a native copy can without a suspension. No row is left in progress, the named and ordinary files are added and reach the laptop, and the empty file ends in a terminal state rather than blocking the rest.',
  devices: { phone: 'phone', laptop: 'cli' },
  knownBug:
    'The import scanner takes any copy that ends as cancelled for a suspension, so it stops starting the tick’s other files too, counts none of them, and leaves every row it claimed claimed until a stale claim is freed ten minutes later.',
  bugShowsAs: [
    {
      check: 'the named and ordinary files are added',
      // Files are left claimed, and every other is added.
      matches: (rows: string[][]) =>
        rows.some(([, state]) => state === 'active') &&
        rows.every(([, state]) => state === 'active' || state === 'added'),
    },
    {
      check: 'phone has no import left in progress',
      matches: (rows: Record<string, number>) => (rows.active ?? 0) > 0 && !rows.pending,
    },
    // Which copy runs first differs between platforms, and the empty file can be among those left claimed.
    { check: 'the empty file has exactly one finished row', got: 0, sometimes: true },
  ],
  timeoutMs: 6 * 60_000,
  async run({ devices, converge, step, checkEqual, checkContent, note, waitFor, workDir }) {
    const phone = devices.phone
    const paths = [
      `${workDir}/empty.txt`,
      `${workDir}/a name with spaces.txt`,
      `${workDir}/one.bin`,
      `${workDir}/two.bin`,
      `${workDir}/three.bin`,
    ]
    await Bun.write(paths[0], new Uint8Array(0))
    for (const path of paths.slice(1))
      await Bun.write(path, crypto.getRandomValues(new Uint8Array(8192)))
    await step('the next import copy will end as cancelled', () =>
      phone.call('sim.cancelNextImportCopy'),
    )
    const importId = await step('phone imports all five in one pick', () =>
      phone.importFiles(paths),
    )
    const unfinished = async () =>
      (
        await phone.sql<{ n: number }>(
          "SELECT count(*) AS n FROM import_files WHERE importId = ?1 AND state IN ('pending', 'active')",
          importId,
        )
      )[0]?.n ?? 0
    // A cancelled copy is retried after a backoff, so this waits longer than one copy takes.
    await waitFor('every row to finish', async () => (await unfinished()) === 0 || undefined, {
      timeoutMs: 120_000,
      intervalMs: 1000,
    }).catch(() => {})
    const rows = await phone.sql<{ name: string; state: string }>(
      'SELECT name, state FROM import_files WHERE importId = ?1 ORDER BY name',
      importId,
    )
    note(`empty file ended ${rows.find((r) => r.name === 'empty.txt')?.state}`)
    checkEqual(
      'the empty file has exactly one finished row',
      rows.filter((r) => r.name === 'empty.txt' && r.state !== 'pending' && r.state !== 'active')
        .length,
      1,
    )
    checkEqual(
      'the named and ordinary files are added',
      rows.filter((r) => r.name !== 'empty.txt').map((r) => [r.name, r.state]),
      [
        ['a name with spaces.txt', 'added'],
        ['one.bin', 'added'],
        ['three.bin', 'added'],
        ['two.bin', 'added'],
      ],
    )
    // A file left unimported never reaches the laptop, and the check above says so.
    if ((await unfinished()) > 0) return
    await step('both converge', () => converge(undefined, { timeoutMs: 120_000 }))
    await checkContent()
  },
})
