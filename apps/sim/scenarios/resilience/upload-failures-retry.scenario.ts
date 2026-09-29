import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'uploads that fail at the network are retried until every file is uploaded once',
  description:
    'The next three upload commits from the phone fail. The phone keeps retrying, every file ends up uploaded and on the laptop, and no content is pinned twice.',
  devices: { phone: 'cli', laptop: 'cli' },
  timeoutMs: 3 * 60_000,
  async run({ network, seed, converge, step, checkEqual, checkContent }) {
    await network.addFault({
      op: 'commit',
      device: 'phone',
      count: 3,
      message: 'hosts unreachable',
    })
    const files = await step('phone adds 4 files', () => seed('phone', { count: 4, size: 8192 }))
    await step('both converge', () => converge(undefined, { timeoutMs: 120_000 }))
    const failed = (await network.requests({ device: 'phone', op: 'commit' })).filter(
      (r) => r.status !== 200,
    )
    checkEqual('the three injected failures happened', failed.length, 3)
    const pinned = await network.objects()
    checkEqual('one pinned object per file', pinned.length, files.length)
    await checkContent()
  },
})
