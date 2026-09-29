import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'when several adds in a row fail, every file still ends up pointing at its own bytes',
  description:
    'The next five adds on the phone fail, as an add does when it cannot read its file. The phone retries. Every file reaches the laptop, and each file on both devices points at an object holding that file’s bytes, not another file’s.',
  devices: { phone: 'cli', laptop: 'cli' },
  timeoutMs: 3 * 60_000,
  knownBug:
    'The uploader keeps abandoned adds in its batch after a failed add, then pins objects to files by position, so later files get other files’ bytes.',
  bugShowsAs: ['points at an object holding its own bytes'],
  async run({ network, seed, converge, step, checkEqual, checkContent }) {
    await network.addFault({
      op: 'blob',
      device: 'phone',
      count: 5,
      message: 'could not read the file',
    })
    const files = await step('phone adds 8 files', () => seed('phone', { count: 8, size: 4096 }))
    await step('both converge', () => converge(undefined, { timeoutMs: 120_000 }))
    checkEqual('one pinned object per file', (await network.objects()).length, files.length)
    checkEqual('all five injected failures happened', await network.faults(), [])
    await checkContent()
  },
})
