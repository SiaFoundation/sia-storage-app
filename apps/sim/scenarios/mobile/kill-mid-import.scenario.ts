import { defineScenario } from '../../src/scenario'
import { seedFiles } from '../../src/seed'

export default defineScenario({
  name: 'killing the phone while it copies an import resumes the import with nothing lost, duplicated or stuck',
  description:
    'The phone starts importing 30 files of 2 MB and is killed as soon as the import is recorded, while rows are still waiting to be copied. After a relaunch every file is added once, no import row is left pending or active, and the laptop gets all 30.',
  devices: { phone: 'phone', laptop: 'cli' },
  timeoutMs: 8 * 60_000,
  async run({ devices, converge, step, precondition, checkEqual, checkContent, workDir }) {
    const phone = devices.phone
    const paths = seedFiles(workDir, { prefix: 'import', count: 30, size: 2 * 1024 * 1024 })
    const importId = await step('phone starts importing 30 files', () => phone.importFiles(paths))
    // Killed without waiting: the copier finishes 2 MB files quickly, so any
    // wait for it to be partway risks finding it already done.
    await step('kill the app', () => phone.kill())
    await precondition('the kill lands before every row is copied', async () => {
      const [unfinished] = await phone.sql<{ n: number }>(
        `SELECT count(*) AS n FROM import_files WHERE importId = ?1 AND state IN ('pending', 'active')`,
        importId,
      )
      return unfinished.n > 0
    })
    await step('relaunch it', () => phone.start())
    const states = await step('wait for every row to finish', () => phone.waitForImport(importId))
    checkEqual('all 30 rows are added', states, { added: 30 })
    const { files } = await step('both converge', () => converge(undefined, { timeoutMs: 180_000 }))
    checkEqual('both hold 30 files, none added twice', files, 30)
    await checkContent()
  },
})
