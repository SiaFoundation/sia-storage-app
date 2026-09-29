import { defineScenario } from '../../src/scenario'
import { seedFiles } from '../../src/seed'
import { suspendAndCheckLocks, suspensionErrors } from './phone'

export default defineScenario({
  name: 'a phone sent to the background while an import is copying holds no database lock on iOS and completes the file once',
  description:
    'The phone imports one 32 MB file, and sim holds the copy after its bytes land and before it publishes them, so the import is in flight when the phone goes to the background. Suspended on iOS, it holds no hazardous lock. Back in the foreground the hold is released, the import completes, the file is uploaded once, and the laptop gets it with its bytes.',
  devices: { phone: 'phone', laptop: 'cli' },
  knownBug: {
    ios: 'A suspension cuts off the import tick while it copies the file, and the next tick frees the file’s claim only once it is ten minutes old, so the file sits unimported until then.',
  },
  bugShowsAs: ['to finish import', 'the file is added'],
  timeoutMs: 8 * 60_000,
  async run({
    devices,
    network,
    converge,
    step,
    precondition,
    check,
    note,
    checkEqual,
    checkContent,
    waitFor,
    workDir,
  }) {
    const phone = devices.phone
    const [path] = seedFiles(workDir, { prefix: 'large', count: 1, size: 32 * 1024 * 1024 })
    // A local copy finishes in well under a second on a fast Mac, so without
    // the hold no poll can see it running and the suspension misses it.
    await step('hold import copies before they publish', () => phone.call('sim.holdImportCopies'))
    const importId = await step('phone starts importing the file', () => phone.importFiles([path]))
    const state = async () => {
      const [row] = await phone.sql<{ state: string }>(
        'SELECT state FROM import_files WHERE importId = ?1',
        importId,
      )
      return row?.state
    }
    await precondition('the file is copying before the phone goes to the background', async () =>
      waitFor(
        'the import row to be claimed',
        async () => (await state()) === 'active' || undefined,
      ),
    )
    await suspendAndCheckLocks(phone, { step, check, note, precondition }, undefined, {
      name: 'the file is still copying when the phone is in the background',
      holds: async () => (await state()) === 'active',
    })
    await step('bring the phone back', () => phone.foreground())
    await step('release the held copy', () => phone.call('sim.releaseImportCopies'))
    // Once released, a 32 MB copy finishes in seconds, so a minute is ample
    // and a stuck import is reported without waiting out a longer timeout.
    checkEqual('the file is added', await phone.waitForImport(importId, 60_000), { added: 1 })
    const { files } = await step('both converge', () => converge(undefined, { timeoutMs: 240_000 }))
    checkEqual('both hold the file', files, 1)
    checkEqual('the file is pinned once', (await network.objects()).length, 1)
    checkEqual('the phone logged no suspension error', await suspensionErrors(phone), [])
    await checkContent()
  },
})
