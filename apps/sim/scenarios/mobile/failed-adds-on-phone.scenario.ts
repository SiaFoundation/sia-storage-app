import { defineScenario } from '../../src/scenario'
import { seedFiles } from '../../src/seed'

export default defineScenario({
  name: 'when several of the phone’s adds fail in a row, every file still points at its own bytes',
  description:
    'The phone imports 8 files in one pick, so its uploader adds several to one batch, and the next five adds fail, as an add does when it cannot read its file. The phone retries through its own uploader. Every file reaches the laptop, and each file on both devices points at an object holding that file’s bytes.',
  devices: { phone: 'phone', laptop: 'cli' },
  timeoutMs: 8 * 60_000,
  knownBug:
    'The uploader keeps abandoned adds in its batch after a failed add, then pins objects to files by position, so later files get other files’ bytes.',
  bugShowsAs: ['points at an object holding its own bytes', 'one pinned object per file'],
  async run({ devices, network, converge, step, precondition, checkEqual, checkContent, workDir }) {
    const phone = devices.phone
    const paths = seedFiles(workDir, { prefix: 'batch', count: 8, size: 16 * 1024 })
    await network.addFault({
      op: 'blob',
      device: 'phone',
      count: 5,
      message: 'could not read the file',
    })
    const importId = await step('phone imports 8 files in one pick', () => phone.importFiles(paths))
    checkEqual('all 8 are added', await phone.waitForImport(importId), { added: 8 })
    const { files } = await step('both converge', () => converge(undefined, { timeoutMs: 180_000 }))
    // Setup rather than behavior: with a fault left over, the adds did not
    // fail the way this scenario is about.
    await precondition(
      'all five injected failures happened',
      async () => (await network.faults()).length === 0,
    )
    checkEqual('both hold all 8', files, 8)
    checkEqual('one pinned object per file', (await network.objects()).length, 8)
    await checkContent()
  },
})
