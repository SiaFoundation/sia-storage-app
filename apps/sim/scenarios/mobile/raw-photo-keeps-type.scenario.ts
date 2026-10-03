import { typeProblems } from '../../src/filetypes'
import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'a DNG photo imported on the phone keeps its raw type there and on a laptop',
  description:
    'The phone imports a DNG under its own extension through its file picker. The phone stores it as image/dng, on iOS still does after its thumbnail scanner has tried the file, and the laptop receives it as image/dng.',
  devices: { phone: 'phone', laptop: 'cli' },
  knownBug:
    'The import types a file by its bytes first, and a DNG begins with TIFF’s signature, so the phone stores it as image/tiff while its bytes stay under .dng, where the uploader cannot find them, and it never reaches the laptop.',
  bugShowsAs: ['image/dng', 'local copy of the DNG'],
  timeoutMs: 6 * 60_000,
  async run({
    devices: { phone, laptop },
    seedTypes,
    step,
    converge,
    precondition,
    check,
    checkEqual,
    checkContent,
    note,
    waitFor,
  }) {
    const files = await step('phone imports a DNG', () =>
      seedTypes('phone', { types: ['dng'], names: 'plain' }),
    )
    const [file] = files
    const typeOn = async (device: typeof laptop | typeof phone) =>
      (
        await device.sql<{ type: string }>(
          "SELECT type FROM files WHERE name = ?1 AND kind = 'file'",
          file.name,
        )
      )[0]?.type
    const imported = await step('phone has finished the import', () =>
      waitFor('the import to finish', () => typeOn(phone), { timeoutMs: 60_000, intervalMs: 1000 }),
    )
    checkEqual('phone imports it as image/dng', imported, 'image/dng')
    // Only iOS thumbnails DNG, and neither platform thumbnails a file stored as image/tiff.
    if (phone.kind === 'ios' && imported === 'image/dng') {
      const [row] = await phone.sql<{ id: string }>(
        "SELECT id FROM files WHERE name = ?1 AND kind = 'file'",
        file.name,
      )
      // The scanner checks a candidate's type against its bytes, and may
      // retype it, before it logs an attempt at a thumbnail size.
      await precondition("the phone's thumbnail scanner tries the DNG", () =>
        waitFor(
          'a thumbnail scanner attempt on the DNG',
          async () =>
            (
              await phone.sql(
                "SELECT 1 FROM logs WHERE scope = 'thumbnailScanner' AND message = 'attempt' AND data LIKE '%' || ?1 || '%'",
                row.id,
              )
            ).length > 0,
          { timeoutMs: 60_000, intervalMs: 2000 },
        ),
      )
      checkEqual(
        'phone still stores it as image/dng after its thumbnail scanner has tried it',
        await typeOn(phone),
        'image/dng',
      )
    } else if (phone.kind !== 'ios') {
      note('Android does not thumbnail DNG, so its thumbnail scanner never checks the type')
    }
    const [stored] = await phone.sql<{ id: string; type: string }>(
      "SELECT id, type FROM files WHERE name = ?1 AND kind = 'file'",
      file.name,
    )
    check(
      'phone finds its local copy of the DNG at the path its stored type names',
      stored !== undefined &&
        (await phone.call<string | null>('fs.getFileUri', { id: stored.id, type: stored.type })) !==
          null,
    )
    const reached = await waitFor('the laptop to receive the DNG', () => typeOn(laptop), {
      timeoutMs: 60_000,
      intervalMs: 2000,
    }).catch(() => undefined)
    checkEqual('laptop receives it as image/dng', reached, 'image/dng')
    const problems = await typeProblems(phone, files)
    checkEqual("phone records the hash of the DNG's imported bytes", problems.wrongHash, [])
    // A DNG that never reached the laptop leaves nothing to converge on, and
    // the check above already says so.
    if (reached !== undefined) {
      await step('both converge', () => converge())
      await checkContent()
    }
  },
})
