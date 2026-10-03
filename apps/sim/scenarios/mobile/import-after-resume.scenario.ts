import { defineScenario } from '../../src/scenario'
import { suspendAndCheckLocks, suspensionErrors } from './phone'
import { seedFiles } from '../../src/seed'

export default defineScenario({
  name: 'importing the moment the phone comes back from suspension loses no write, five times over',
  description:
    'Five times, the phone is suspended and brought back, and a file is imported as soon as it answers again. On iOS each suspension holds no hazardous lock. All five files are added and reach the laptop, and the phone logs no suspension error.',
  devices: { phone: 'phone', laptop: 'cli' },
  timeoutMs: 10 * 60_000,
  async run({
    devices,
    converge,
    step,
    check,
    note,
    precondition,
    checkEqual,
    checkContent,
    workDir,
  }) {
    const phone = devices.phone
    const paths = seedFiles(workDir, { prefix: 'resume', count: 5, size: 32 * 1024 })
    for (const [i, path] of paths.entries()) {
      await suspendAndCheckLocks(phone, { step, check, note, precondition }, `suspension ${i + 1}`)
      await step(`bring the phone back and import file ${i + 1}`, async () => {
        await phone.foreground()
        await phone.addFile(path)
      })
    }
    const { files } = await step('both converge', () => converge(undefined, { timeoutMs: 120_000 }))
    checkEqual('both hold all five', files, 5)
    checkEqual('the phone logged no suspension error', await suspensionErrors(phone), [])
    await checkContent()
  },
})
